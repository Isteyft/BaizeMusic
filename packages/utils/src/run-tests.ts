import assert from "node:assert/strict";

import { parseLrc } from "./lyric.js";
import { formatTime } from "./time.js";

function testFormatTime(): void {
  assert.equal(formatTime(0), "00:00");
  assert.equal(formatTime(9.9), "00:09");
  assert.equal(formatTime(65), "01:05");
  assert.equal(formatTime(600), "10:00");
  assert.equal(formatTime(-1), "00:00");
  assert.equal(formatTime(Number.NaN), "00:00");
  assert.equal(formatTime(Number.POSITIVE_INFINITY), "00:00");
}

function testParseLrcBasic(): void {
  const text = "[00:01.00]hello\n[00:10.50]world";
  const parsed = parseLrc(text);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0]!.time, 1);
  assert.equal(parsed[0]!.text, "hello");
  assert.equal(parsed[1]!.time, 10.5);
  assert.equal(parsed[1]!.text, "world");
}

function testParseLrcMultiTagAndFallback(): void {
  const text = "[00:01.00][00:02.00]\n[00:03.00]line";
  const parsed = parseLrc(text);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0]!.text, "...");
  assert.equal(parsed[1]!.text, "...");
  assert.equal(parsed[2]!.text, "line");
}

function testParseLrcIgnoreInvalid(): void {
  const text = "abc\n[bad]x\n[00:01.00]ok";
  const parsed = parseLrc(text);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]!.text, "ok");
}

function run(): void {
  testFormatTime();
  testParseLrcBasic();
  testParseLrcMultiTagAndFallback();
  testParseLrcIgnoreInvalid();
  console.log("All utils tests passed.");
}

run();
