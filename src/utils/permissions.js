const { PermissionFlagsBits } = require('discord.js');
const { getTournamentAdminRoles } = require('../data/serverSettings');

function isAdmin(member) {
  return member.permissions.has(PermissionFlagsBits.Administrator);
}

async function canManageTournaments(member) {
  if (member.permissions.has(PermissionFlagsBits.ManageGuild) ||
      member.permissions.has(PermissionFlagsBits.Administrator)) {
    return true;
  }

  const adminRoles = await getTournamentAdminRoles(member.guild.id);
  return adminRoles.some(roleId => member.roles.cache.has(roleId));
}

function isTournamentCreator(member, tournament) {
  return tournament.createdBy === member.id;
}

async function canEditTournament(member, tournament) {
  return await canManageTournaments(member) || isTournamentCreator(member, tournament);
}

module.exports = {
  isAdmin,
  canManageTournaments,
  isTournamentCreator,
  canEditTournament,
};
