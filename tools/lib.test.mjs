import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { parseDevArgs, venvPy } from './lib.mjs';

test('venvPy picks Scripts/python.exe on Windows, bin/python elsewhere', () => {
  assert.equal(venvPy('win32'), join('atalaia', '.venv', 'Scripts', 'python.exe'));
  assert.equal(venvPy('linux'), join('atalaia', '.venv', 'bin', 'python'));
});

test('parseDevArgs', () => {
  assert.deepEqual(parseDevArgs([]), { mobile: true, port: undefined });
  assert.deepEqual(parseDevArgs(['--no-mobile', '--port', '3200']), { mobile: false, port: '3200' });
  assert.equal(parseDevArgs(['--port', 'abc']), null);
  assert.equal(parseDevArgs(['--port']), null);
  assert.equal(parseDevArgs(['--bogus']), null);
});
