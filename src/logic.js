export const RED_SOX_ID = 111;
export const YANKEES_ID = 147;
export const AL_ID = 103;

export function relativeGap(teamRecord, redSoxRecord) {
  return (
    (teamRecord.wins - redSoxRecord.wins +
      redSoxRecord.losses -
      teamRecord.losses) /
    2
  );
}

export function buildTeamMap(records) {
  const redSox = records.find((record) => record.team.id === RED_SOX_ID);

  if (!redSox) {
    throw new Error("Boston is missing from the American League standings.");
  }

  const redSoxGamesPlayed = redSox.gamesPlayed ?? redSox.wins + redSox.losses;
  const redSoxGamesRemaining = Math.max(0, 162 - redSoxGamesPlayed);
  const teams = records.map((record) => {
    const gap = relativeGap(record, redSox);
    const distance = Math.abs(gap);
    const gamesPlayed = record.gamesPlayed ?? record.wins + record.losses;
    const gamesRemaining = Math.max(0, 162 - gamesPlayed);
    const winningPercentage = gamesPlayed > 0 ? record.wins / gamesPlayed : 0.5;

    // The window shrinks with both teams' remaining schedules; proximity removes
    // teams outside that window; the record factor rewards teams above .500;
    // threat combines those two signals without a fixed late-season cutoff.
    const raceWindow = Math.sqrt(redSoxGamesRemaining + gamesRemaining);
    const proximity = Math.max(0, raceWindow - distance);
    const recordFactor = winningPercentage / 0.5;
    const threat = proximity * recordFactor;

    return {
      ...record,
      gap,
      distance,
      gamesRemaining,
      raceWindow,
      threat,
      eligible: record.team.id !== RED_SOX_ID && threat > 0,
    };
  });

  return new Map(teams.map((record) => [record.team.id, record]));
}

export function isPlayoffTeam(record) {
  const wildCardRank = Number.parseInt(record.wildCardRank, 10);
  return String(record.divisionRank) === "1" || (Number.isInteger(wildCardRank) && wildCardRank <= 3);
}

function compareTargets(left, right) {
  if (left.threat !== right.threat) {
    return right.threat - left.threat;
  }

  if (left.distance !== right.distance) {
    return left.distance - right.distance;
  }

  const leftAhead = left.gap > 0 ? 1 : 0;
  const rightAhead = right.gap > 0 ? 1 : 0;
  return rightAhead - leftAhead;
}

export function rankGames(games, teamMap) {
  const redSoxGame = games.find(
    (game) =>
      game.teams.away.team.id === RED_SOX_ID ||
      game.teams.home.team.id === RED_SOX_ID,
  );

  const recommendations = games
    .filter((game) => game !== redSoxGame)
    .map((game) => {
      const sides = [game.teams.away, game.teams.home];
      const eligible = sides
        .map((side) => teamMap.get(side.team.id))
        .filter((record) => record?.eligible)
        .sort(compareTargets);

      if (eligible.length === 0) {
        return null;
      }

      const target = eligible[0];
      const targetSide = sides.find((side) => side.team.id === target.team.id);
      const rootForSide = sides.find((side) => side !== targetSide);
      const rootForRecord = teamMap.get(rootForSide.team.id);
      const rankingDifference = Math.abs(target.threat - (rootForRecord?.threat ?? 0));

      // A Yankees win is never an acceptable recommendation.
      if (rootForSide.team.id === YANKEES_ID) {
        return null;
      }

      return {
        game,
        target,
        targetSide,
        rootForSide,
        rankingDifference,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (left.rankingDifference !== right.rankingDifference) {
        return right.rankingDifference - left.rankingDifference;
      }
      const targetOrder = compareTargets(left.target, right.target);
      if (targetOrder !== 0) return targetOrder;
      return new Date(left.game.gameDate) - new Date(right.game.gameDate);
    })
    .slice(0, 5);

  return { redSoxGame, recommendations };
}

export function flattenStandings(standings) {
  return standings.records.flatMap((division) => division.teamRecords);
}
