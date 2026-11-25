// Letting the page draw between two pieces of work.

/** Let the page draw a frame's worth of other work. Not a timer: the capture's virtual clock holds timers back. */
export const breathe = () =>
  new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(0);
  });
