// SPDX-License-Identifier: MIT
import "@testing-library/jest-dom";
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider, useToast } from "./ToastProvider";

function ToastControls() {
  const { showToast, dismissAll } = useToast();
  return (
    <>
      <button
        onClick={() =>
          showToast({
            message: "Saved changes",
            title: "Complete",
            variant: "success",
            duration: 0,
          })
        }
      >
        Show success
      </button>
      <button
        onClick={() =>
          showToast({
            message: "Request failed",
            variant: "error",
            duration: 0,
          })
        }
      >
        Show error
      </button>
      <button onClick={dismissAll}>Dismiss all</button>
    </>
  );
}

describe("ToastProvider", () => {
  it("announces toast variants, allows dismissal, and can clear all notifications", () => {
    render(
      <ToastProvider>
        <ToastControls />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show success" }));
    expect(screen.getByRole("status")).toHaveTextContent("Saved changes");
    expect(screen.getByRole("status")).toHaveTextContent("Complete");
    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss notification" }),
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show error" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Request failed");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss all" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("automatically dismisses toasts after their duration", () => {
    jest.useFakeTimers();
    try {
      render(
        <ToastProvider defaultDuration={2000}>
          <TimedToastControl />
        </ToastProvider>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Show timed toast" }));
      expect(screen.getByRole("status")).toBeInTheDocument();
      act(() => jest.advanceTimersByTime(2000));
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it("requires a provider", () => {
    function InvalidConsumer() {
      useToast();
      return null;
    }
    expect(() => render(<InvalidConsumer />)).toThrow(
      "useToast must be used within a ToastProvider.",
    );
  });
});

function TimedToastControl() {
  const { showToast } = useToast();
  return (
    <button onClick={() => showToast({ message: "Temporary notice" })}>
      Show timed toast
    </button>
  );
}
