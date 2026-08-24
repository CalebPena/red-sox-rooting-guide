import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTeamMap,
  flattenStandings,
  isPlayoffTeam,
  rankGames,
  relativeGap,
} from "./logic.js";

const team = (id, name, wins, losses) => ({
  team: { id, name },
  wins,
  losses,
});

const divisionTeam = (record, divisionId, divisionRank) => ({
  ...record,
  divisionId,
  divisionRank: String(divisionRank),
});

const side = (record, leagueId = 103) => ({
  team: { ...record.team, league: { id: leagueId } },
});

const game = (away, home, date = "2026-08-03T23:00:00Z") => ({
  gamePk: `${away.team.id}-${home.team.id}`,
  gameDate: date,
  teams: { away, home },
  status: { abstractGameState: "Preview", detailedState: "Scheduled" },
});

const redSox = team(111, "Red Sox", 60, 50);

test("relative gap handles unequal games played", () => {
  assert.equal(relativeGap(team(1, "Ahead", 62, 49), redSox), 1.5);
  assert.equal(relativeGap(team(2, "Behind", 57, 52), redSox), -2.5);
});

test("the race window excludes teams too far from Boston", () => {
  const map = buildTeamMap([redSox, team(1, "Inside", 51, 59), team(2, "Outside", 47, 63)]);
  assert.equal(map.get(1).eligible, true);
  assert.equal(map.get(2).eligible, false);
});

test("playoff teams include division leaders and the top three wild cards", () => {
  assert.equal(isPlayoffTeam({ divisionRank: "1" }), true);
  assert.equal(isPlayoffTeam({ divisionRank: "2", wildCardRank: "3" }), true);
  assert.equal(isPlayoffTeam({ divisionRank: "2", wildCardRank: "4" }), false);
});

test("other division leaders use the shorter route to Boston relevance", () => {
  const boston = divisionTeam(redSox, 201, 2);
  const eastLeader = divisionTeam(team(147, "Yankees", 65, 45), 201, 1);
  const centralLeader = divisionTeam(team(1, "Central Leader", 61, 49), 202, 1);
  const centralRunnerUp = divisionTeam(team(2, "Central Runner Up", 60, 50), 202, 2);
  const map = buildTeamMap([boston, eastLeader, centralLeader, centralRunnerUp]);
  const leader = map.get(centralLeader.team.id);

  assert.equal(leader.directDistance, 1);
  assert.equal(leader.wildCardPath, 1);
  assert.equal(leader.divisionWinnerPath, 9);
  assert.equal(leader.distance, 1);
});

test("protected other division leaders are farther away than their direct gap", () => {
  const boston = divisionTeam(redSox, 201, 2);
  const eastLeader = divisionTeam(team(147, "Yankees", 62, 48), 201, 1);
  const centralLeader = divisionTeam(team(1, "Central Leader", 59, 51), 202, 1);
  const centralRunnerUp = divisionTeam(team(2, "Central Runner Up", 57, 53), 202, 2);
  const map = buildTeamMap([boston, eastLeader, centralLeader, centralRunnerUp]);
  const leader = map.get(centralLeader.team.id);

  assert.equal(leader.directDistance, 1);
  assert.equal(leader.wildCardPath, 5);
  assert.equal(leader.divisionWinnerPath, 5);
  assert.equal(leader.distance, 5);
});

test("other division leaders use direct distance when Boston leads the East", () => {
  const boston = divisionTeam(redSox, 201, 1);
  const westLeader = divisionTeam(team(1, "West Leader", 63, 47), 200, 1);
  const westRunnerUp = divisionTeam(team(2, "West Runner Up", 59, 51), 200, 2);
  const map = buildTeamMap([boston, westLeader, westRunnerUp]);
  const leader = map.get(westLeader.team.id);

  assert.equal(leader.directDistance, 3);
  assert.equal(leader.divisionWinnerPath, 3);
  assert.equal(leader.distance, 3);
});

test("flattenStandings preserves division identity", () => {
  const standings = {
    records: [
      {
        division: { id: 201 },
        teamRecords: [redSox],
      },
    ],
  };

  assert.equal(flattenStandings(standings)[0].divisionId, 201);
});

test("equal distance favors the stronger team", () => {
  const ahead = team(1, "Ahead", 62, 48);
  const behind = team(2, "Behind", 58, 52);
  const map = buildTeamMap([redSox, ahead, behind]);
  const result = rankGames([game(side(behind), side(ahead))], map);
  assert.equal(result.recommendations[0].target.team.id, ahead.team.id);
  assert.ok(result.recommendations[0].rankingDifference > 0);
});

test("matchup strength subtracts record-adjusted threat scores", () => {
  const astros = team(1, "Astros", 58, 52);
  const rangers = team(2, "Rangers", 55, 55);
  const map = buildTeamMap([redSox, astros, rangers]);

  const result = rankGames([game(side(rangers), side(astros))], map);

  assert.equal(map.get(astros.team.id).gap, -2);
  assert.equal(map.get(rangers.team.id).gap, -5);
  assert.equal(
    result.recommendations[0].rankingDifference,
    Math.abs(map.get(astros.team.id).threat - map.get(rangers.team.id).threat),
  );
});

test("identical records produce no rooting preference", () => {
  const first = team(1, "First", 59, 51);
  const second = team(2, "Second", 59, 51);
  const map = buildTeamMap([redSox, first, second]);

  const result = rankGames([game(side(first), side(second))], map);

  assert.equal(result.recommendations[0].rankingDifference, 0);
});

test("interleague matchups subtract zero from the AL team's threat", () => {
  const yankees = team(147, "Yankees", 62, 48);
  const cardinals = team(138, "Cardinals", 55, 55);
  const map = buildTeamMap([redSox, yankees]);

  const result = rankGames([game(side(cardinals, 104), side(yankees))], map);

  assert.equal(result.recommendations[0].rankingDifference, map.get(yankees.team.id).threat);
});

test("teams beyond the dynamic race window have zero threat", () => {
  const closeTeam = team(1, "Close", 58, 52);
  const filteredTeam = team(2, "Filtered", 47, 63);
  const map = buildTeamMap([redSox, closeTeam, filteredTeam]);

  const result = rankGames([game(side(filteredTeam), side(closeTeam))], map);

  assert.equal(map.get(filteredTeam.team.id).eligible, false);
  assert.equal(result.recommendations[0].rankingDifference, map.get(closeTeam.team.id).threat);
});

test("games that recommend a Yankees win are omitted", () => {
  const yankees = team(147, "Yankees", 58, 52);
  const closerTeam = team(1, "Closer", 59, 51);
  const map = buildTeamMap([redSox, yankees, closerTeam]);
  const result = rankGames([game(side(yankees), side(closerTeam))], map);
  assert.equal(result.recommendations.length, 0);
});

test("an interleague Yankees loss remains a recommendation", () => {
  const yankees = team(147, "Yankees", 62, 48);
  const cardinals = team(138, "Cardinals", 55, 55);
  const map = buildTeamMap([redSox, yankees]);
  const result = rankGames([game(side(cardinals, 104), side(yankees))], map);
  assert.equal(result.recommendations[0].rootForSide.team.id, cardinals.team.id);
});

test("Red Sox games are separate and recommendations stop at five", () => {
  const opponents = Array.from({ length: 6 }, (_, index) =>
    team(index + 1, `Opponent ${index + 1}`, 59 - index, 51 + index),
  );
  const nlTeams = opponents.map((_, index) =>
    team(index + 201, `NL ${index + 1}`, 50, 50),
  );
  const map = buildTeamMap([redSox, ...opponents]);
  const games = [
    game(side(redSox), side(nlTeams[0], 104)),
    ...opponents.map((opponent, index) =>
      game(side(nlTeams[index], 104), side(opponent)),
    ),
  ];

  const result = rankGames(games, map);
  assert.equal(result.redSoxGames.length, 1);
  assert.equal(result.redSoxGames[0].teams.away.team.id, 111);
  assert.equal(result.recommendations.length, 5);
  assert.equal(result.recommendations[0].target.team.id, opponents[0].team.id);
});

test("both Red Sox doubleheader games stay out of recommendations", () => {
  const opponent = team(1, "Opponent", 59, 51);
  const map = buildTeamMap([redSox, opponent]);
  const firstGame = { ...game(side(redSox), side(opponent)), gamePk: "game-1", gameNumber: 1 };
  const secondGame = { ...game(side(redSox), side(opponent)), gamePk: "game-2", gameNumber: 2 };

  const result = rankGames([firstGame, secondGame], map);

  assert.deepEqual(result.redSoxGames.map(({ gamePk }) => gamePk), ["game-1", "game-2"]);
  assert.equal(result.recommendations.length, 0);
});
