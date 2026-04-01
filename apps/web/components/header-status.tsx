"use client";

import { createContext, useContext } from "react";

import { StatusPill } from "@/components/status-pill";

type HeaderStatus = {
  api: boolean;
  llm: boolean;
  tts: boolean;
  asr: boolean;
};

const HeaderStatusContext = createContext<HeaderStatus | null>(null);

export function HeaderStatusProvider({
  value,
  children,
}: {
  value: HeaderStatus;
  children: React.ReactNode;
}) {
  return <HeaderStatusContext.Provider value={value}>{children}</HeaderStatusContext.Provider>;
}

export function HeaderStatusStrip({ className }: { className?: string }) {
  const status = useContext(HeaderStatusContext);

  if (!status) {
    return null;
  }

  return (
    <div className={className ?? "flex flex-wrap items-center justify-end gap-2"}>
      <StatusPill label="API" tone={status.api ? "healthy" : "danger"} />
      <StatusPill label="LLM" tone={status.llm ? "healthy" : "danger"} />
      <StatusPill label="TTS" tone={status.tts ? "healthy" : "danger"} />
      <StatusPill label="ASR" tone={status.asr ? "healthy" : "danger"} />
    </div>
  );
}
