module.exports = {
  extends: ['@commitlint/config-conventional'],
  ignores: [
    (message) =>
      typeof message === 'string' &&
      message.includes('Signed-off-by: dependabot[bot]'),
  ],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'bot',
        'build',
        'chore',
        'ci',
        'docs',
        'feat',
        'fix',
        'perf',
        'refactor',
        'revert',
        'style',
        'test',
      ],
    ],
  },
};
