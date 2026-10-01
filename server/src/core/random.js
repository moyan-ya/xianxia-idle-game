/**
 * 种子随机数：所有概率（灵根、突破、战斗）都从这里出。
 * 同一个 seed 必然得到同一串结果 —— 这是"服务端复算防作弊"的地基。
 */
const crypto = require('crypto');

/** mulberry32：小巧、够用、可复现 */
function createRng(seed) {
  let a = (Number(seed) || 0) >>> 0;
  return function rng() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomSeed() {
  return crypto.randomBytes(4).readUInt32BE(0);
}

function randInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function randFloat(rng, min, max) {
  return rng() * (max - min) + min;
}

function chance(rng, rate) {
  return rng() < rate;
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

/** 抽五行灵根 */
function rollRoots(rng, elements, min, max) {
  const roots = {};
  elements.forEach((el) => { roots[el] = randInt(rng, min, max); });
  return roots;
}

module.exports = { createRng, randomSeed, randInt, randFloat, chance, pick, rollRoots };
