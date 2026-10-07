/**
 * Manage QA accounts for the shared control panel (stored in .sgap/qa-users.json).
 *
 *   npx pnpm qa:users list
 *   npx pnpm qa:users add <name> [--role tester|admin|viewer] [--password <pw>]
 *   npx pnpm qa:users passwd <name> [--password <pw>]
 *   npx pnpm qa:users role <name> <tester|admin|viewer>
 *   npx pnpm qa:users disable|enable|remove <name>
 *
 * Without --password a random one is generated and printed once.
 * Changes apply immediately; the panel does not need a restart.
 */
import { randomBytes } from 'node:crypto';

import { ROLES, loadUsers, makeUser, saveUsers, setPassword, usersFile, validateNewUser } from './lib/qa-users.mjs';

const [command, name, third] = process.argv.slice(2).filter((arg, index, all) => !arg.startsWith('--') && !all[index - 1]?.startsWith('--'));

function option(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fail(message) {
  console.error(`qa:users: ${message}`);
  process.exit(1);
}

const users = loadUsers();
const find = () => users.findIndex((user) => user.name.toLowerCase() === String(name ?? '').toLowerCase());
const generated = () => randomBytes(9).toString('base64url');

switch (command) {
  case undefined:
  case 'list': {
    if (users.length === 0) {
      console.log('No QA accounts yet. Add one: npx pnpm qa:users add <name> --role admin');
      break;
    }
    for (const user of users) {
      console.log(`${user.name.padEnd(24)} ${user.role.padEnd(7)} ${user.disabled ? 'disabled' : 'active'}   since ${user.createdAt?.slice(0, 10) ?? '?'}`);
    }
    break;
  }
  case 'add': {
    const role = option('--role') ?? 'tester';
    const password = option('--password') ?? generated();
    const problem = validateNewUser(users, name ?? '', role, password);
    if (problem) fail(problem);
    saveUsers([...users, makeUser(name, role, password)]);
    console.log(`Added ${name} (${role}).`);
    if (!option('--password')) console.log(`Password: ${password}   (shown once; change with: npx pnpm qa:users passwd ${name})`);
    break;
  }
  case 'passwd': {
    const index = find();
    if (index < 0) fail(`no account "${name}"`);
    const password = option('--password') ?? generated();
    if (password.length < 8) fail('Password must be at least 8 characters.');
    users[index] = setPassword(users[index], password);
    saveUsers(users);
    console.log(`Password changed for ${users[index].name}.`);
    if (!option('--password')) console.log(`Password: ${password}`);
    break;
  }
  case 'role': {
    const index = find();
    if (index < 0) fail(`no account "${name}"`);
    if (!ROLES.includes(third)) fail(`role must be one of ${ROLES.join(', ')}`);
    users[index] = { ...users[index], role: third };
    saveUsers(users);
    console.log(`${users[index].name} is now ${third}.`);
    break;
  }
  case 'disable':
  case 'enable': {
    const index = find();
    if (index < 0) fail(`no account "${name}"`);
    users[index] = { ...users[index], disabled: command === 'disable' };
    saveUsers(users);
    console.log(`${users[index].name} ${command}d.`);
    break;
  }
  case 'remove': {
    const index = find();
    if (index < 0) fail(`no account "${name}"`);
    const [removed] = users.splice(index, 1);
    saveUsers(users);
    console.log(`Removed ${removed.name}.`);
    break;
  }
  default:
    fail(`unknown command "${command}". Commands: list, add, passwd, role, disable, enable, remove. Accounts file: ${usersFile()}`);
}
