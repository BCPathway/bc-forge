import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Modal } from "./Modal";

describe("Modal Component", () => {
  const defaultProps = {
    isOpen: true,
    onClose: jest.fn(),
    title: "Test Modal Summary",
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  test("renders nothing when isOpen is false", () => {
    const { container } = render(
      <Modal {...defaultProps} isOpen={false}>
        <div>Modal Content Content</div>
      </Modal>
    );
    expect(container.firstChild).toBeNull();
  });

  test("renders modal elements correctly when isOpen is true", () => {
    render(
      <Modal {...defaultProps}>
        <div>Modal Content Content</div>
      </Modal>
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Test Modal Summary")).toBeInTheDocument();
    expect(screen.getByText("Modal Content Content")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /close modal/i })).toBeInTheDocument();
  });

  test("calls onClose when click happens on close button or overlay backdrop", () => {
    render(
      <Modal {...defaultProps}>
        <div>Content</div>
      </Modal>
    );

    // Click the X close button
    const closeBtn = screen.getByRole("button", { name: /close modal/i });
    fireEvent.click(closeBtn);
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);

    // Click the outer backdrop layer (the role="dialog" parent wrapper element)
    const overlay = screen.getByRole("dialog").parentElement!;
    fireEvent.click(overlay);
    expect(defaultProps.onClose).toHaveBeenCalledTimes(2);
  });

  test("does not call onClose when click happens inside the modal panel contents", () => {
    render(
      <Modal {...defaultProps}>
        <button data-testid="inside-btn">Inside</button>
      </Modal>
    );

    const insideBtn = screen.getByTestId("inside-btn");
    fireEvent.click(insideBtn);
    expect(defaultProps.onClose).not.toHaveBeenCalled();
  });

  test("triggers onClose callback when Escape button is pressed", () => {
    render(
      <Modal {...defaultProps}>
        <div>Content</div>
      </Modal>
    );

    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });
});