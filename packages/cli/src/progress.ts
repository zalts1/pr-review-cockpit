/** Progress goes to stderr so stdout stays parseable. */
export function progress(label: string): (message: string) => void {
  const started = Date.now();
  return (message: string) => {
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.error(`[${label} +${seconds}s] ${message}`);
  };
}
