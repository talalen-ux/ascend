export const SATO_HOOK_ABI = [
  { type: "function", name: "cumulativeEth", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "price", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "curveSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "sato", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  {
    type: "function",
    name: "quoteBuy",
    stateMutability: "view",
    inputs: [{ type: "uint256", name: "ethIn" }],
    outputs: [
      { type: "uint256", name: "satoOut" },
      { type: "uint256", name: "fee" },
    ],
  },
  {
    type: "function",
    name: "quoteSell",
    stateMutability: "view",
    inputs: [{ type: "uint256", name: "satoIn" }],
    outputs: [
      { type: "uint256", name: "ethOut" },
      { type: "uint256", name: "fee" },
    ],
  },
  { type: "function", name: "buy", stateMutability: "payable", inputs: [], outputs: [] },
  { type: "function", name: "sell", stateMutability: "nonpayable", inputs: [{ type: "uint256", name: "satoIn" }], outputs: [] },
  {
    type: "event",
    name: "Buy",
    inputs: [
      { type: "address", name: "buyer", indexed: true },
      { type: "uint256", name: "ethPaid" },
      { type: "uint256", name: "fee" },
      { type: "uint256", name: "satoOut" },
      { type: "uint256", name: "cumulativeEth" },
    ],
  },
  {
    type: "event",
    name: "Sell",
    inputs: [
      { type: "address", name: "seller", indexed: true },
      { type: "uint256", name: "satoBurned" },
      { type: "uint256", name: "fee" },
      { type: "uint256", name: "ethOut" },
      { type: "uint256", name: "cumulativeEth" },
    ],
  },
] as const;

export const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;
