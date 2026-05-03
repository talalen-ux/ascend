export const stateUpdatedEvent = {
  type: "event",
  name: "StateUpdated",
  inputs: [
    { name: "F", type: "int256", indexed: false },
    { name: "D", type: "int256", indexed: false },
    { name: "C", type: "int256", indexed: false },
    { name: "multiplier", type: "int256", indexed: false },
  ],
} as const;
