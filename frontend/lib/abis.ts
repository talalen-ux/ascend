// Minimal ABI fragments. Generated equivalents may be produced from forge artifacts.

export const ascentHookAbi = [
  { type: "function", name: "F", stateMutability: "view", inputs: [{ name: "poolId", type: "bytes32" }], outputs: [{ type: "int256" }] },
  { type: "function", name: "V", stateMutability: "view", inputs: [{ name: "poolId", type: "bytes32" }], outputs: [{ type: "int256" }] },
  { type: "function", name: "D", stateMutability: "view", inputs: [{ name: "poolId", type: "bytes32" }], outputs: [{ type: "int256" }] },
  { type: "function", name: "C", stateMutability: "view", inputs: [{ name: "poolId", type: "bytes32" }], outputs: [{ type: "int256" }] },
  { type: "function", name: "treasury", stateMutability: "view", inputs: [{ name: "poolId", type: "bytes32" }], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "computeMultiplier",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "event",
    name: "StateUpdated",
    inputs: [
      { name: "poolId", type: "bytes32", indexed: true },
      { name: "F", type: "int256", indexed: false },
      { name: "V", type: "int256", indexed: false },
      { name: "D", type: "int256", indexed: false },
      { name: "C", type: "int256", indexed: false },
      { name: "multiplier", type: "uint256", indexed: false },
      { name: "treasury", type: "uint256", indexed: false },
    ],
  },
] as const;

export const ascentQuoterAbi = [
  {
    type: "function",
    name: "quoteExactInput",
    stateMutability: "view",
    inputs: [
      {
        name: "key",
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
      },
      { name: "zeroForOne", type: "bool" },
      { name: "amountIn", type: "uint256" },
      { name: "baseOut", type: "uint256" },
    ],
    outputs: [
      {
        name: "q",
        type: "tuple",
        components: [
          { name: "multiplier", type: "uint256" },
          { name: "adjustedOut", type: "uint256" },
          { name: "hookCharge", type: "uint256" },
          { name: "isBuy", type: "bool" },
          { name: "treasuryCapped", type: "bool" },
        ],
      },
    ],
  },
] as const;

export const poolSwapTestAbi = [
  {
    type: "function",
    name: "swap",
    stateMutability: "payable",
    inputs: [
      {
        name: "key",
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
      },
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "zeroForOne", type: "bool" },
          { name: "amountSpecified", type: "int256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
      {
        name: "testSettings",
        type: "tuple",
        components: [
          { name: "takeClaims", type: "bool" },
          { name: "settleUsingBurn", type: "bool" },
        ],
      },
      { name: "hookData", type: "bytes" },
    ],
    outputs: [{ type: "int256" }],
  },
] as const;
