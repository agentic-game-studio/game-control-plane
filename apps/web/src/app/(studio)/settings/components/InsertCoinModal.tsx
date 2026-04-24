"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";

interface InsertCoinModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (amount: number) => Promise<unknown>;
}

export function InsertCoinModal({ isOpen, onClose, onSubmit }: InsertCoinModalProps) {
  const [amount, setAmount] = useState("1000");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    const num = parseInt(amount, 10);
    if (!num || num <= 0) return;
    setLoading(true);
    try {
      await onSubmit(num);
      setAmount("1000");
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="INSERT COIN"
      onSubmit={handleSubmit}
      submitLabel={loading ? "Processing..." : "CONFIRM"}
      submitDisabled={loading}
    >
      <div className="flex flex-col gap-4">
        <p className="font-[var(--font-terminal)] text-sm text-[#434656]">
          Add on-top credits to your account. These credits never expire.
        </p>
        <div className="border-2 border-black bg-[#f3f2ff] p-4">
          <label className="font-[var(--font-label)] text-[10px] uppercase text-[#737688] tracking-widest block mb-2">
            Amount
          </label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min={1}
            step={100}
            className="w-full border-2 border-black bg-white p-3 font-[var(--font-headline)] text-2xl font-bold uppercase focus:outline-none focus:bg-[#f3f2ff]"
          />
        </div>
        <div className="flex gap-2">
          {["500", "1000", "5000", "10000"].map((preset) => (
            <button
              key={preset}
              onClick={() => setAmount(preset)}
              className="flex-1 border-2 border-black bg-white py-2 font-[var(--font-terminal)] text-xs uppercase hover:bg-black hover:text-white transition-colors"
            >
              +{preset}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
