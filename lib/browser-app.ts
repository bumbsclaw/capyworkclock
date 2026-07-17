type ListenerHandle = {
  remove: () => Promise<void>;
};

export const App = {
  async addListener(): Promise<ListenerHandle> {
    return {
      async remove() {},
    };
  },
};
