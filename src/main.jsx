import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AL_ID,
  RED_SOX_ID,
  buildTeamMap,
  flattenStandings,
  isPlayoffTeam,
  rankGames,
} from "./logic.js";
import "./styles.css";

const API = "https://statsapi.mlb.com/api/v1";
const pitcherEraCache = new Map();
const SHOW_LIVE_MOCK = new URLSearchParams(window.location.search).get("mock") === "live";

async function pitcherEra(pitcherId, season, signal) {
  const cacheKey = `${season}:${pitcherId}`;
  if (!pitcherEraCache.has(cacheKey)) {
    const request = fetch(
      `${API}/people/${pitcherId}/stats?stats=season&group=pitching&season=${season}`,
      { signal },
    )
      .then((response) => response.ok ? response.json() : null)
      .then((data) => data?.stats?.[0]?.splits?.[0]?.stat?.era ?? null)
      .catch((error) => {
        pitcherEraCache.delete(cacheKey);
        if (error.name === "AbortError") throw error;
        return null;
      });
    pitcherEraCache.set(cacheKey, request);
  }

  return pitcherEraCache.get(cacheKey);
}

async function addPitcherEras(games, season, signal) {
  await Promise.all(
    games.filter(Boolean).flatMap((game) => [game.teams.away, game.teams.home]).map(async (side) => {
      if (!side.probablePitcher?.id) return;
      side.probablePitcher.era = await pitcherEra(side.probablePitcher.id, season, signal);
    }),
  );
}

function easternDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function shiftDate(date, days) {
  const shifted = new Date(`${date}T12:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function DayArrow({ direction }) {
  const points = direction === "previous" ? "14 5 8 11 14 17" : "8 5 14 11 8 17";
  return (
    <svg aria-hidden="true" viewBox="0 0 22 22">
      <polyline points={points} />
    </svg>
  );
}

function displayDate(date) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

function gameTime(game) {
  const state = game.status.abstractGameState;
  if (isPostponed(game) || isDelayed(game)) return game.status.detailedState;
  if (state === "Live") {
    const inningState = game.linescore?.inningState;
    const inning = game.linescore?.currentInningOrdinal;
    const inningLabel = inningState && inning ? `${inningState} ${inning}` : null;

    return inningLabel || game.status.detailedState;
  }
  if (state === "Final") return "Final";
  if (game.status.startTimeTBD) return "Time TBD";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(game.gameDate));
}

function isDelayed(game) {
  return /delay/i.test(game.status.detailedState ?? "");
}

function isPostponed(game) {
  return /postponed/i.test(game.status.detailedState ?? "");
}

function score(game, sideName) {
  return sideScore(game, game.teams[sideName]);
}

function sideScore(game, side) {
  if (!["Live", "Final"].includes(game.status.abstractGameState)) return null;
  return Number.isInteger(side.score) ? side.score : null;
}

function teamLabel(team) {
  return team.teamName || team.clubName || team.name;
}

function probablePitcherLabel(pitcher) {
  if (!pitcher) return null;
  return `${pitcher.fullName}${pitcher.era ? ` · ${pitcher.era} ERA` : ""}`;
}

function mockLiveGame(game) {
  const source = game ?? {
    gamePk: "mock-live-game",
    gameDate: new Date().toISOString(),
    venue: { name: "Fenway Park" },
    teams: {
      away: { team: { id: 133, abbreviation: "ATH", name: "Athletics", teamName: "Athletics" } },
      home: { team: { id: RED_SOX_ID, abbreviation: "BOS", name: "Boston Red Sox", teamName: "Red Sox" } },
    },
  };
  const soxSideName = source.teams.away.team.id === RED_SOX_ID ? "away" : "home";
  const opponentSideName = soxSideName === "away" ? "home" : "away";

  return {
    ...source,
    isMock: true,
    status: { abstractGameState: "Live", detailedState: "In Progress" },
    teams: {
      ...source.teams,
      [soxSideName]: { ...source.teams[soxSideName], score: 5 },
      [opponentSideName]: { ...source.teams[opponentSideName], score: 3 },
    },
    linescore: {
      ...source.linescore,
      currentInning: 7,
      currentInningOrdinal: "7th",
      inningState: soxSideName === "away" ? "Top" : "Bottom",
      outs: 2,
      offense: {
        first: { id: 680776, fullName: "Jarren Duran" },
        third: { id: 678882, fullName: "Ceddanne Rafaela" },
      },
    },
  };
}

function mockLiveRecommendations(recommendations) {
  const situations = [
    { scores: [4, 2], inning: 6, outs: 1, occupied: ["second"] },
    { scores: [1, 3], inning: 3, outs: 0, occupied: [] },
    { scores: [5, 5], inning: 8, outs: 2, occupied: ["first", "third"] },
    { scores: [7, 4], inning: 5, outs: 1, occupied: ["first"] },
    { scores: [2, 6], inning: 9, outs: 2, occupied: ["first", "second", "third"] },
  ];

  return recommendations.map((item, index) => {
    const situation = situations[index % situations.length];
    const [rootScore, targetScore] = situation.scores;
    const rootForSide = { ...item.rootForSide, score: rootScore };
    const targetSide = { ...item.targetSide, score: targetScore };
    const sideForTeam = (side) => side.team.id === rootForSide.team.id ? rootForSide : targetSide;
    const rootIsAway = item.game.teams.away.team.id === rootForSide.team.id;
    const offense = Object.fromEntries(
      situation.occupied.map((base, runnerIndex) => [
        base,
        { id: `mock-runner-${index}-${runnerIndex}`, fullName: "Mock runner" },
      ]),
    );

    return {
      ...item,
      rootForSide,
      targetSide,
      game: {
        ...item.game,
        status: {
          abstractGameState: "Live",
          detailedState: "In Progress",
        },
        teams: {
          away: sideForTeam(item.game.teams.away),
          home: sideForTeam(item.game.teams.home),
        },
        linescore: {
          currentInning: situation.inning,
          currentInningOrdinal: `${situation.inning}${situation.inning === 3 ? "rd" : "th"}`,
          inningState: rootIsAway ? "Top" : "Bottom",
          outs: situation.outs,
          offense,
        },
      },
    };
  });
}

function BaseDiamond({ offense = {}, outs = 0 }) {
  const baseRadius = 7;
  const bases = [
    { key: "first", label: "First base", x: 35, y: 17 },
    { key: "second", label: "Second base", x: 26, y: 8 },
    { key: "third", label: "Third base", x: 17, y: 17 },
  ];
  const occupiedBases = bases.filter(({ key }) => offense[key]);
  const runners = occupiedBases.length
    ? occupiedBases.map(({ key, label }) => `${label}: ${offense[key].fullName}`).join("; ")
    : "Bases empty";
  const outCount = Number.isInteger(outs) ? Math.min(Math.max(outs, 0), 3) : 0;

  return (
    <div className="live-bases" role="img" aria-label={`${runners}; ${outCount} ${outCount === 1 ? "out" : "outs"}`}>
      <svg className="base-diamond" viewBox="0 0 52 25" aria-hidden="true">
        {bases.map(({ key, x, y }) => (
          <polygon
            className={`base-diamond__base ${offense[key] ? "base-diamond__base--occupied" : ""}`}
            points={`${x},${y - baseRadius} ${x + baseRadius},${y} ${x},${y + baseRadius} ${x - baseRadius},${y}`}
            key={key}
          />
        ))}
      </svg>
      <span className="out-count" aria-hidden="true">
        {[0, 1, 2].map((out) => (
          <span className={out < outCount ? "out-count__dot out-count__dot--recorded" : "out-count__dot"} key={out} />
        ))}
      </span>
    </div>
  );
}

function SoxGame({ game, teamMap, gameLabel }) {
  if (!game) {
    return (
      <section className="sox-game sox-game--off">
        <p className="eyebrow">Boston today</p>
        <h2>The Sox are off.</h2>
        <p>Use the night to watch the teams around them lose.</p>
      </section>
    );
  }

  const opponentSide = [game.teams.away, game.teams.home].find(
    (side) => side.team.id !== RED_SOX_ID,
  );
  const soxSideName = game.teams.away.team.id === RED_SOX_ID ? "away" : "home";
  const opponentSideName = soxSideName === "away" ? "home" : "away";
  const soxScore = score(game, soxSideName);
  const opponentScore = score(game, opponentSideName);
  const hasScore = soxScore !== null && opponentScore !== null;
  const isUpcoming = game.status.abstractGameState === "Preview";
  const soxPitcher = probablePitcherLabel(game.teams[soxSideName].probablePitcher);
  const opponentPitcher = probablePitcherLabel(opponentSide.probablePitcher);
  const hasPitchingMatchup = isUpcoming && (soxPitcher || opponentPitcher);
  const isFinal = game.status.abstractGameState === "Final";
  const isInterrupted = isDelayed(game) || isPostponed(game);
  const result = !isFinal || !hasScore || soxScore === opponentScore
    ? null
    : soxScore > opponentScore
      ? "favorable"
      : "unfavorable";
  const resultLabel = !isFinal || !hasScore
    ? null
    : soxScore === opponentScore
      ? "Final · Tie"
      : `Sox ${result === "favorable" ? "win" : "lose"}`;
  const resultClass = result
    ? `sox-game--${result}`
    : (isFinal && hasScore && soxScore === opponentScore) || isInterrupted
      ? "sox-game--neutral"
      : "";
  const locationLabel = soxSideName === "home" ? "vs" : "at";
  const displaySides = [game.teams[soxSideName], opponentSide];
  const opponentStanding = teamMap?.get(opponentSide.team.id);
  const gameMeta = [isFinal && !isInterrupted ? null : gameTime(game), isUpcoming ? game.venue?.name : null].filter(Boolean).join(" · ");

  return (
    <section className={`sox-game ${resultClass}`}>
      <div className="recommendation__matchup">
        <div className="recommendation__matchup-heading">
          <p className="eyebrow">
            {gameLabel || "Red Sox matchup"}
            {game.isMock && <span className="mock-badge">Mock live view</span>}
          </p>
          <div className="recommendation__status">
            {gameMeta && <span className="game-time">{gameMeta}</span>}
            {resultLabel && (
              <strong className="result-badge">
                <span aria-hidden="true">{result === "favorable" ? "✓" : result === "unfavorable" ? "×" : "•"}</span>
                {resultLabel}
              </strong>
            )}
          </div>
        </div>
        <div className="recommendation__teams">
          {displaySides.map((side, index) => (
            <React.Fragment key={side.team.id}>
              {index === 1 && <span className="recommendation__separator">{locationLabel}</span>}
              <div className={`recommendation__team ${index === 0 ? "recommendation__team--pick" : ""}`}>
                <div className="recommendation__team-name">
                  <h3>{teamLabel(side.team)}</h3>
                  {index === 1 && opponentStanding && <MatchupGap gap={opponentStanding.gap} />}
                </div>
              </div>
            </React.Fragment>
          ))}
        </div>
        {hasScore && (
          <div className={`sox-game__score ${isFinal ? "sox-game__score--final" : ""}`} aria-label="Game score">
            <strong>{soxScore}</strong>
            {game.status.abstractGameState === "Live"
              ? <BaseDiamond offense={game.linescore?.offense} outs={game.linescore?.outs} />
              : <span>Score</span>}
            <strong>{opponentScore}</strong>
          </div>
        )}
        {hasPitchingMatchup && (
          <div className="sox-game__score sox-game__score--pitchers" aria-label="Probable pitchers">
            <strong>{soxPitcher || "TBD"}</strong>
            <span>Pitchers</span>
            <strong>{opponentPitcher || "TBD"}</strong>
          </div>
        )}
      </div>
    </section>
  );
}

function gapLabel(gap) {
  if (gap === 0) return "even with Boston";
  const amount = Number.isInteger(Math.abs(gap)) ? Math.abs(gap) : Math.abs(gap).toFixed(1);
  return `${amount} ${Math.abs(gap) === 1 ? "game" : "games"} ${gap > 0 ? "ahead of" : "behind"} Boston`;
}

function RaceGap({ gap }) {
  if (gap === 0) return <strong className="race-gap race-gap--even">BOS</strong>;

  const amount = Number.isInteger(Math.abs(gap)) ? Math.abs(gap) : Math.abs(gap).toFixed(1);
  const direction = gap > 0 ? "ahead" : "behind";

  return (
    <strong
      className={`race-gap race-gap--${direction}`}
      aria-label={gapLabel(gap)}
      title={gapLabel(gap)}
    >
      <span aria-hidden="true">{gap > 0 ? "↑" : "↓"}</span> {amount}
    </strong>
  );
}

function MatchupGap({ gap }) {
  const amount = Number.isInteger(Math.abs(gap)) ? Math.abs(gap) : Math.abs(gap).toFixed(1);

  return (
    <span className="recommendation__gap" aria-label={gapLabel(gap)} title={gapLabel(gap)}>
      <strong>
        <span aria-hidden="true">{gap === 0 ? "↔" : gap > 0 ? "↑" : "↓"}</span> {amount}
      </strong>
    </span>
  );
}

function PickIndicator() {
  return (
    <span className="pick-indicator">Boston’s pick</span>
  );
}

function opponentLabel(teamId, games) {
  const matchups = games.flatMap((game) => {
    const isAway = game.teams.away.team.id === teamId;
    const isHome = game.teams.home.team.id === teamId;
    if (!isAway && !isHome) return [];

    const opponent = isAway ? game.teams.home.team : game.teams.away.team;
    return [`${isAway ? "at" : "vs"} ${teamLabel(opponent)}`];
  });

  return matchups.length ? matchups.join(" / ") : "Off";
}

function Recommendation({ item, rank, teamMap }) {
  const { game, targetSide, rootForSide } = item;
  const isFinal = game.status.abstractGameState === "Final";
  const isInterrupted = isDelayed(game) || isPostponed(game);
  const rootScore = sideScore(game, rootForSide);
  const targetScore = sideScore(game, targetSide);
  const hasScore = rootScore !== null && targetScore !== null;
  const isUpcoming = game.status.abstractGameState === "Preview";
  const rootPitcher = probablePitcherLabel(rootForSide.probablePitcher);
  const targetPitcher = probablePitcherLabel(targetSide.probablePitcher);
  const hasPitchingMatchup = isUpcoming && (rootPitcher || targetPitcher);
  const result = !isFinal || !hasScore || rootScore === targetScore
    ? null
    : rootScore > targetScore
      ? "favorable"
      : "unfavorable";
  const resultLabel = !isFinal || !hasScore
    ? null
    : rootScore === targetScore
      ? "Final · Tie"
      : result === "favorable" ? "Favorable result" : "Unfavorable result";
  const resultClass = result
    ? `recommendation--${result}`
    : (isFinal && hasScore && rootScore === targetScore) || isInterrupted
      ? "recommendation--neutral"
      : "";
  const displaySides = [rootForSide, targetSide];
  const matchupSeparator = rootForSide.team.id === game.teams.away.team.id ? "at" : "vs";

  return (
    <article className={`recommendation ${resultClass}`}>
      <div className="recommendation__matchup">
        <div className="recommendation__matchup-heading">
          <p className="eyebrow">{String(rank).padStart(2, "0")}</p>
          <PickIndicator />
          <div className="recommendation__status">
            {(!isFinal || isInterrupted) && <span className="game-time">{gameTime(game)}</span>}
            {resultLabel && (
              <strong className="result-badge">
                <span aria-hidden="true">{result === "favorable" ? "✓" : result === "unfavorable" ? "×" : "•"}</span>
                {resultLabel}
              </strong>
            )}
          </div>
        </div>
        <div className="recommendation__teams">
          {displaySides.map((side, index) => {
            const isPick = index === 0;
            const standing = teamMap.get(side.team.id);
            return (
              <React.Fragment key={side.team.id}>
                {index === 1 && <span className="recommendation__separator">{matchupSeparator}</span>}
                <div className={`recommendation__team recommendation__team--${isPick ? "pick" : "target"}`}>
                  <div className="recommendation__team-name">
                    <h3>{teamLabel(side.team)}</h3>
                    {standing && <MatchupGap gap={standing.gap} />}
                  </div>
                </div>
              </React.Fragment>
            );
          })}
        </div>
        {hasScore && (
          <div className={`sox-game__score recommendation__score ${isFinal ? "sox-game__score--final" : ""}`} aria-label="Game score">
            <strong>{rootScore}</strong>
            {game.status.abstractGameState === "Live"
              ? <BaseDiamond offense={game.linescore?.offense} outs={game.linescore?.outs} />
              : <span>Score</span>}
            <strong>{targetScore}</strong>
          </div>
        )}
        {hasPitchingMatchup && (
          <div className="sox-game__score sox-game__score--pitchers recommendation__score" aria-label="Probable pitchers">
            <strong>{rootPitcher || "TBD"}</strong>
            <span>Pitchers</span>
            <strong>{targetPitcher || "TBD"}</strong>
          </div>
        )}
      </div>
    </article>
  );
}

function RaceLine({ teamMap, games }) {
  const teams = [...teamMap.values()]
    .sort((a, b) => b.gap - a.gap);

  return (
    <aside className="race-line">
      <div className="section-heading">
        <h2>Standings</h2>
      </div>
      <div className="race-line__list">
        {teams.map((team) => {
          const inPlayoffs = isPlayoffTeam(team);

          return (
            <div
              className={`race-team ${inPlayoffs ? "race-team--playoff" : ""} ${team.team.id === RED_SOX_ID ? "race-team--sox" : ""}`}
              key={team.team.id}
            >
              <span className="race-team__heading">
                <span className="race-team__name">{teamLabel(team.team)}</span>
                {inPlayoffs && <span className="playoff-badge">Playoff</span>}
              </span>
              <span className="race-team__details">
                <span>{team.wins}-{team.losses}</span>
                <span aria-hidden="true">·</span>
                <span>{opponentLabel(team.team.id, games)}</span>
              </span>
              <RaceGap gap={team.gap} />
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function Loading() {
  return (
    <main className="state-page" aria-live="polite">
      <span className="loader" />
      <p>Reading today’s standings…</p>
    </main>
  );
}

function App() {
  const [date, setDate] = useState(easternDate);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const season = date.slice(0, 4);
    const apiDate = `${date.slice(5, 7)}/${date.slice(8, 10)}/${season}`;

    setData(null);
    setError("");

    async function loadData(initialLoad = false) {
      try {
        const [standingsResponse, scheduleResponse] = await Promise.all([
          fetch(`${API}/standings?leagueId=${AL_ID}&season=${season}&standingsTypes=regularSeason&date=${apiDate}`, {
            signal: controller.signal,
          }),
          fetch(`${API}/schedule?sportId=1&date=${date}&hydrate=team,linescore,venue,probablePitcher`, {
            signal: controller.signal,
          }),
        ]);

        if (!standingsResponse.ok || !scheduleResponse.ok) {
          throw new Error("MLB data is unavailable right now.");
        }

        const [standings, schedule] = await Promise.all([
          standingsResponse.json(),
          scheduleResponse.json(),
        ]);
        const records = flattenStandings(standings);
        const teamMap = buildTeamMap(records);
        const games = schedule.dates[0]?.games ?? [];
        const rankedGames = rankGames(games, teamMap);
        const displayedGames = [
          ...rankedGames.redSoxGames,
          ...rankedGames.recommendations.map(({ game }) => game),
        ];
        await addPitcherEras(displayedGames, season, controller.signal);
        const redSoxGames = SHOW_LIVE_MOCK
          ? (rankedGames.redSoxGames.length ? rankedGames.redSoxGames : [null]).map(mockLiveGame)
          : rankedGames.redSoxGames;
        const recommendations = SHOW_LIVE_MOCK
          ? mockLiveRecommendations(rankedGames.recommendations)
          : rankedGames.recommendations;
        setData({ teamMap, games, ...rankedGames, redSoxGames, recommendations });
      } catch (requestError) {
        if (requestError.name !== "AbortError" && initialLoad) {
          setError(requestError.message);
        }
      }
    }

    loadData(true);
    const refreshInterval = date === easternDate()
      ? window.setInterval(() => loadData(), 30_000)
      : null;

    return () => {
      controller.abort();
      if (refreshInterval) window.clearInterval(refreshInterval);
    };
  }, [date]);

  return (
    <div className="site-shell">
      <div className="date-bar">
        <button onClick={() => setDate(shiftDate(date, -1))} aria-label="Previous day" type="button">
          <DayArrow direction="previous" />
        </button>
        <div>
          <span>Today’s card</span>
          <strong>{displayDate(date)}</strong>
        </div>
        <button onClick={() => setDate(shiftDate(date, 1))} aria-label="Next day" type="button">
          <DayArrow direction="next" />
        </button>
      </div>

      {error ? (
        <main className="state-page" role="alert">
          <h1>Couldn’t load the card.</h1>
          <p>{error}</p>
          <button className="retry" onClick={() => window.location.reload()}>Try again</button>
        </main>
      ) : !data ? (
        <Loading />
      ) : (
        <main>
          {data.redSoxGames.length ? (
            <div className="sox-games">
              {data.redSoxGames.map((game, index) => (
                <SoxGame
                  game={game}
                  gameLabel={data.redSoxGames.length > 1 ? `Red Sox matchup · Game ${index + 1}` : null}
                  key={game.gamePk}
                  teamMap={data.teamMap}
                />
              ))}
            </div>
          ) : (
            <SoxGame game={null} teamMap={data.teamMap} />
          )}
          <div className="content-grid">
            <section className="guide">
              <div className="section-heading section-heading--guide">
                <div>
                  <h1>Who to root for</h1>
                </div>
              </div>

              {data.recommendations.length ? (
                <div className="recommendations">
                  {data.recommendations.map((item, index) => (
                    <Recommendation
                      item={item}
                      rank={index + 1}
                      key={item.game.gamePk}
                      teamMap={data.teamMap}
                    />
                  ))}
                </div>
              ) : (
                <div className="empty-card">
                  <h2>No useful games today.</h2>
                  <p>Every relevant team is off, too far back, or would require rooting for New York.</p>
                </div>
              )}
            </section>
            <RaceLine teamMap={data.teamMap} games={data.games} />
          </div>
        </main>
      )}

    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
