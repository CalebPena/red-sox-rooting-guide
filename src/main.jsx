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
  if (state === "Live") {
    const inningState = game.linescore?.inningState;
    const inning = game.linescore?.currentInningOrdinal;
    const outs = game.linescore?.outs;
    const inningLabel = inningState && inning ? `${inningState} ${inning}` : null;
    const outsLabel = ["Top", "Bottom"].includes(inningState) && Number.isInteger(outs)
      ? `${outs} ${outs === 1 ? "out" : "outs"}`
      : null;

    return [inningLabel, outsLabel].filter(Boolean).join(" · ") || game.status.detailedState;
  }
  if (state === "Final") return "Final";
  if (game.status.startTimeTBD) return "Time TBD";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(game.gameDate));
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

function TeamMark({ team, small = false }) {
  return (
    <span className={`team-mark ${small ? "team-mark--small" : ""}`} aria-hidden="true">
      {team.abbreviation || teamLabel(team).slice(0, 3).toUpperCase()}
    </span>
  );
}

function Matchup({ game, emphasizedTeamId }) {
  return (
    <div className="matchup">
      {["away", "home"].map((sideName) => {
        const side = game.teams[sideName];
        return (
          <div
            className={`matchup__team ${side.team.id === emphasizedTeamId ? "matchup__team--root" : ""}`}
            key={sideName}
          >
            <TeamMark team={side.team} small />
            <span>{teamLabel(side.team)}</span>
            {score(game, sideName) !== null && (
              <strong className="matchup__score">{score(game, sideName)}</strong>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SoxGame({ game }) {
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

  return (
    <section className="sox-game">
      <div>
        <p className="eyebrow">Boston today</p>
        <h2>Beat {teamLabel(opponentSide.team)}</h2>
        <p className="sox-game__meta">{gameTime(game)} · {game.venue?.name}</p>
      </div>
      <Matchup game={game} emphasizedTeamId={RED_SOX_ID} />
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
        {gap === 0 ? "EVEN" : <><span aria-hidden="true">{gap > 0 ? "↑" : "↓"}</span> {amount}</>}
      </strong>
      <span>vs BOS</span>
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
  const hasFinalScore = Number.isInteger(rootForSide.score) && Number.isInteger(targetSide.score);
  const favorable = isFinal && hasFinalScore ? rootForSide.score > targetSide.score : null;
  const resultClass = favorable === null
    ? ""
    : favorable
      ? "recommendation--favorable"
      : "recommendation--unfavorable";
  const displaySides = [rootForSide, targetSide];
  const matchupSeparator = rootForSide.team.id === game.teams.away.team.id ? "at" : "vs";

  return (
    <article className={`recommendation ${resultClass}`}>
      <div className="recommendation__rank">{String(rank).padStart(2, "0")}</div>
      <div className="recommendation__matchup">
        <div className="recommendation__matchup-heading">
          <p className="eyebrow">Matchup</p>
          <div className="recommendation__status">
            <span className="game-time">{gameTime(game)}</span>
            {favorable !== null && (
              <strong className="result-badge">
                <span aria-hidden="true">{favorable ? "✓" : "×"}</span>
                {favorable ? "Favorable result" : "Unfavorable result"}
              </strong>
            )}
          </div>
        </div>
        <div className="recommendation__teams">
          {displaySides.map((side, index) => {
            const isPick = index === 0;
            const standing = teamMap.get(side.team.id);
            const displayedScore = sideScore(game, side);
            return (
              <React.Fragment key={side.team.id}>
                {index === 1 && <span className="recommendation__separator">{matchupSeparator}</span>}
                <div className={`recommendation__team ${isPick ? "recommendation__team--pick" : ""}`}>
                  {isPick && <PickIndicator />}
                  <div className="recommendation__team-name">
                    <TeamMark team={side.team} small />
                    <h3>{teamLabel(side.team)}</h3>
                    {displayedScore !== null && <strong>{displayedScore}</strong>}
                  </div>
                  {standing && <MatchupGap gap={standing.gap} />}
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </article>
  );
}

function RaceLine({ teamMap, games }) {
  const teams = [...teamMap.values()]
    .filter((team) => team.team.id === RED_SOX_ID || team.eligible)
    .sort((a, b) => b.gap - a.gap);

  return (
    <aside className="race-line">
      <div className="section-heading">
        <p className="eyebrow">The race line</p>
        <h2>Who is close?</h2>
        <p className="race-line__legend"><span aria-hidden="true" /> Playoff spot today</p>
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
          fetch(`${API}/schedule?sportId=1&date=${date}&hydrate=team,linescore,venue`, {
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
        setData({ teamMap, games, ...rankGames(games, teamMap) });
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
          <SoxGame game={data.redSoxGame} />
          <div className="content-grid">
            <section className="guide">
              <div className="section-heading section-heading--guide">
                <div>
                  <p className="eyebrow">Tonight’s assignment</p>
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
