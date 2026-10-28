require('./helpers/testEnv.js');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCot615Match } = require('../src/domain/entities/cot615Match');
const {
  getLegalMoveError,
  isInCheck,
} = require('../src/domain/entities/xiangqiRules');

const opening = createCot615Match(0).board;

test('all seven Xiangqi piece types accept a legal opening move', () => {
  const moves = [
    ['red', 'e0', 'e1'],
    ['red', 'd0', 'e1'],
    ['red', 'c0', 'e2'],
    ['red', 'b0', 'c2'],
    ['red', 'a0', 'a1'],
    ['red', 'b2', 'b5'],
    ['red', 'a3', 'a4'],
  ];

  for (const [color, from, to] of moves) {
    assert.equal(getLegalMoveError(opening, color, from, to), null, `${from} to ${to}`);
  }
});

test('rejects blocked horse and elephant moves, backward soldiers, and cannons without a screen', () => {
  assert.match(getLegalMoveError(opening, 'red', 'b0', 'd1'), /không đúng luật/i);
  const elephantBlocked = opening.concat({
    id: 'red-blocking-piece',
    color: 'red',
    type: 'soldier',
    position: 'd1',
  });
  assert.match(getLegalMoveError(elephantBlocked, 'red', 'c0', 'e2'), /không đúng luật/i);
  assert.match(getLegalMoveError(opening, 'red', 'e3', 'e2'), /không đúng luật/i);
  assert.match(getLegalMoveError(opening, 'red', 'b2', 'b7'), /không đúng luật/i);
});

test('rejects moves that expose the moving general to a chariot', () => {
  const pieces = [
    { id: 'red-general', color: 'red', type: 'general', position: 'e0' },
    { id: 'black-general', color: 'black', type: 'general', position: 'd9' },
    { id: 'red-blocker', color: 'red', type: 'chariot', position: 'e4' },
    { id: 'black-chariot', color: 'black', type: 'chariot', position: 'e8' },
  ];

  assert.equal(isInCheck(pieces, 'red'), false);
  assert.match(getLegalMoveError(pieces, 'red', 'e4', 'd4'), /Tướng phe bạn bị chiếu/);
});

test('rejects moves that leave the two generals facing each other', () => {
  const pieces = [
    { id: 'red-general', color: 'red', type: 'general', position: 'e0' },
    { id: 'black-general', color: 'black', type: 'general', position: 'e9' },
    { id: 'red-blocker', color: 'red', type: 'chariot', position: 'e4' },
  ];

  assert.equal(isInCheck(pieces, 'red'), false);
  assert.match(getLegalMoveError(pieces, 'red', 'e4', 'd4'), /Tướng phe bạn bị chiếu/);
});

test('rejects wrong-side pieces, friendly captures, and direct general captures', () => {
  assert.match(getLegalMoveError(opening, 'red', 'a9', 'a8'), /thuộc phe của mình/);
  assert.match(getLegalMoveError(opening, 'red', 'a0', 'a3'), /cùng phe/);

  const generals = [
    { id: 'red-general', color: 'red', type: 'general', position: 'e0' },
    { id: 'black-general', color: 'black', type: 'general', position: 'e9' },
  ];
  assert.match(getLegalMoveError(generals, 'red', 'e0', 'e9'), /Không được bắt Tướng/);
});
