import { describe, expect, it } from 'vitest';
import { parseShellLine, stripCommandPrefix } from '../../../src/parsers/shell.js';

const words = (line: string) => parseShellLine(line).map((c) => c.words.map((w) => w.value));

describe('parseShellLine', () => {
  it.each([
    ['npm run build', [['npm', 'run', 'build']]],
    ['  pnpm   test  ', [['pnpm', 'test']]],
    [
      'cd web && pnpm dev',
      [
        ['cd', 'web'],
        ['pnpm', 'dev'],
      ],
    ],
    [
      'make a || make b; make c',
      [
        ['make', 'a'],
        ['make', 'b'],
        ['make', 'c'],
      ],
    ],
    [
      'npm test | tee out.log',
      [
        ['npm', 'test'],
        ['tee', 'out.log'],
      ],
    ],
    ['npm start &', [['npm', 'start']]],
    ['(cd web; make)', [['cd', 'web'], ['make']]],
    ['echo "a b" \'c d\'', [['echo', 'a b', 'c d']]],
    ['echo a\\ b', [['echo', 'a b']]],
    ['npm test 2>&1 > out.txt', [['npm', 'test']]],
    ['npm test &> /dev/null', [['npm', 'test']]],
    ['npm test >>log 2>err', [['npm', 'test']]],
    ['sort < input.txt', [['sort']]],
    ['cat <<EOF', [['cat']]],
    ['npm test # runs vitest', [['npm', 'test']]],
    ['echo a#b', [['echo', 'a#b']]],
    ['', []],
    ['# only a comment', []],
    ['npm run "test:e2e"', [['npm', 'run', 'test:e2e']]],
  ])('%j', (line, expected) => {
    expect(words(line)).toEqual(expected);
  });

  it('keeps word offsets (including quotes)', () => {
    const [cmd] = parseShellLine('npm run "test:e2e"');
    expect(cmd?.words.map((w) => [w.start, w.end])).toEqual([
      [0, 3],
      [4, 7],
      [8, 18],
    ]);
  });

  it('marks expansions as dynamic', () => {
    const [cmd] = parseShellLine('make $TARGET "${X}y" $(date) `id` plain');
    expect(cmd?.words.map((w) => [w.value, w.dynamic])).toEqual([
      ['make', false],
      ['$TARGET', true],
      ['${X}y', true],
      ['$(date)', true],
      ['`id`', true],
      ['plain', false],
    ]);
  });

  it('keeps a $(…) with spaces as one word', () => {
    expect(words('echo $(git rev-parse HEAD) done')).toEqual([
      ['echo', '$(git rev-parse HEAD)', 'done'],
    ]);
  });
});

describe('stripCommandPrefix', () => {
  const strip = (line: string) =>
    stripCommandPrefix(parseShellLine(line)[0]?.words ?? []).map((w) => w.value);

  it.each([
    ['CI=1 NODE_ENV=test npm test', ['npm', 'test']],
    ['sudo -E -u root make install', ['make', 'install']],
    ['env -i PATH=/bin pnpm build', ['pnpm', 'build']],
    ['cross-env NODE_ENV=production pnpm build', ['pnpm', 'build']],
    ['dotenv -e .env.test -- npm run test:e2e', ['npm', 'run', 'test:e2e']],
    ['corepack pnpm install', ['pnpm', 'install']],
    ['time make', ['make']],
    ['npm test', ['npm', 'test']],
    ['dotenv -e .env', []],
  ])('%j', (line, expected) => {
    expect(strip(line)).toEqual(expected);
  });
});
