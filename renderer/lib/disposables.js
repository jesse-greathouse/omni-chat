export function createDisposables() {
  /** @type {(() => void)[]} */
  const bag = [];

  const add = (fn) => {
    if (typeof fn === 'function') bag.push(fn);
    return fn;
  };

  const on = (target, type, handler, opts) => {
    target.addEventListener(type, handler, opts);
    return add(() => {
      try { target.removeEventListener(type, handler, opts); } catch {}
    });
  };

  const timeout = (ms, fn) => {
    const id = setTimeout(fn, ms);
    return add(() => clearTimeout(id));
  };

  const interval = (ms, fn) => {
    const id = setInterval(fn, ms);
    return add(() => clearInterval(id));
  };

  const dispose = () => {
    while (bag.length) {
      const fn = bag.pop();
      try { fn(); } catch {}
    }
  };

  return { add, on, timeout, interval, dispose };
}
