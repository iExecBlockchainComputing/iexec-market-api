const sleep = (ms) =>
  new Promise((res) => {
    setTimeout(res, ms);
  });

export { sleep };
