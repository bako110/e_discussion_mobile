/** `process.env` est remplace en dur par Metro/Babel au moment du bundle. */
declare const process: {
  env: Record<string, string | undefined>;
};
