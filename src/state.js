// App-wide state shared by the pages. app.js sets rerender to its router's render().
export const state = {
  user: null,
  authBusy: false,
  rerender: () => {},
};
