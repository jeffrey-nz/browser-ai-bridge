export function createSpinner(text) {
  console.log(`[Spinner Start] ${text}`);
  return {
    start: () => ({
      update: (t) => console.log(`[Spinner] ${t}`),
      succeed: (t) => console.log(`[Spinner OK] ${t}`),
      fail: (t) => console.error(`[Spinner FAIL] ${t}`),
      info: (t) => console.log(`[Spinner INFO] ${t}`),
      stop: () => {},
    }),
  };
}
