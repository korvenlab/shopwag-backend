beforeEach(() => {
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("teste não pode chamar a rede"));
});

afterEach(() => {
  const called = jest.isMockFunction(globalThis.fetch) && globalThis.fetch.mock.calls.length > 0;
  jest.restoreAllMocks();
  if (called) {
    throw new Error("teste chamou fetch; Mercado Pago e Supabase não entram na suíte");
  }
});
