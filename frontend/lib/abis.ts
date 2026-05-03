export const ascentHookAbi = [
  { type: "function", name: "F", stateMutability: "view", inputs: [], outputs: [{ type: "int256" }] },
  { type: "function", name: "D", stateMutability: "view", inputs: [], outputs: [{ type: "int256" }] },
  { type: "function", name: "C", stateMutability: "view", inputs: [], outputs: [{ type: "int256" }] },
  { type: "function", name: "treasury", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "computeMultiplier",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "event",
    name: "StateUpdated",
    inputs: [
      { name: "F", type: "int256", indexed: false },
      { name: "D", type: "int256", indexed: false },
      { name: "C", type: "int256", indexed: false },
      { name: "multiplier", type: "int256", indexed: false },
    ],
  },
] as const;
