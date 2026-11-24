// SPDX-License-Identifier: MIT
import "@testing-library/jest-dom";
import { act, render, renderHook, screen } from "@testing-library/react";
import {
  TransactionHistory,
  TransactionRecord,
  useSessionTransactions,
} from "./TransactionHistory";

const ADDRESS = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGWEBUSAVCBCY42YOXT";

const tx = (
  hash: string,
  over: Partial<TransactionRecord> = {},
): TransactionRecord => ({
  hash,
  operation: "transfer",
  amount: "25",
  counterparty: ADDRESS,
  status: "success",
  timestamp: 1_700_000_000_000,
  ...over,
});

describe("TransactionHistory", () => {
  beforeEach(() => sessionStorage.clear());

  it("shows an empty message with no transactions", () => {
    render(<TransactionHistory transactions={[]} />);
    expect(screen.getByTestId("transaction-history-empty")).toBeInTheDocument();
  });

  it("renders operation, counterparty, amount, status and an explorer link", () => {
    render(
      <TransactionHistory
        transactions={[
          tx("abc123"),
          tx("def456", { operation: "burn", counterparty: undefined }),
        ]}
        explorerUrl="https://stellar.expert/explorer/testnet/tx/"
      />,
    );
    const rows = screen.getAllByTestId("transaction-history-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("transfer");
    expect(rows[0]).toHaveTextContent("25");
    expect(rows[1]).toHaveTextContent("burn");
    expect(rows[1]).toHaveTextContent("—");
    expect(screen.getAllByRole("link")[0]).toHaveAttribute(
      "href",
      "https://stellar.expert/explorer/testnet/tx/abc123",
    );
  });

  it("respects the limit and omits links without an explorerUrl", () => {
    render(
      <TransactionHistory
        transactions={[tx("a1"), tx("b2"), tx("c3")]}
        limit={2}
      />,
    );
    expect(screen.getAllByTestId("transaction-history-row")).toHaveLength(2);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("useSessionTransactions", () => {
  beforeEach(() => sessionStorage.clear());

  it("records newest first, dedupes by hash, and persists in sessionStorage", () => {
    const { result } = renderHook(() => useSessionTransactions());
    act(() => result.current.record(tx("one")));
    act(() => result.current.record(tx("two")));
    act(() => result.current.record(tx("one", { amount: "9" })));

    expect(result.current.transactions.map((t) => t.hash)).toEqual([
      "one",
      "two",
    ]);
    const [newest] = result.current.transactions;
    expect(newest?.amount).toBe("9");

    const again = renderHook(() => useSessionTransactions());
    expect(again.result.current.transactions).toHaveLength(2);

    act(() => result.current.clear());
    expect(result.current.transactions).toEqual([]);
  });

  it("survives corrupt stored data", () => {
    sessionStorage.setItem("bc-forge:transaction-history", "{not json");
    const { result } = renderHook(() => useSessionTransactions());
    expect(result.current.transactions).toEqual([]);
  });
});
