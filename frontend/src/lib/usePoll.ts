import { useEffect } from "react";

/**
 * Run something now, then on an interval, but only while the page is being
 * looked at.
 *
 * Messages and scenes are polled, since there are no sockets. A plain
 * setInterval kept asking every few seconds from a backgrounded tab on
 * someone's phone: their battery and data for an answer nobody could see, and
 * a request to a laptop for every tab anyone had ever left open. Hiding the
 * tab stops it; showing it again fetches once, so nothing is missed.
 */
export function usePoll(run: () => void, ms: number) {
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;

    function start() {
      if (timer !== undefined) return;
      timer = setInterval(run, ms);
    }

    function stop() {
      if (timer === undefined) return;
      clearInterval(timer);
      timer = undefined;
    }

    function onVisibility() {
      if (document.hidden) {
        stop();
        return;
      }
      run();
      start();
    }

    run();
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [run, ms]);
}
