export const ASCEND_HOOK_ABI = [
  { type: "function", name: "ascend", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "floor", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "price", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "marketCap", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "premiumBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "cumulativeEthIn", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "reserve", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "quoteBuy",
    stateMutability: "view",
    inputs: [{ type: "uint256", name: "ethIn" }],
    outputs: [{ type: "uint256", name: "ascendOut" }, { type: "uint256", name: "fee" }],
  },
  {
    type: "function",
    name: "quoteSell",
    stateMutability: "view",
    inputs: [{ type: "uint256", name: "ascendIn" }],
    outputs: [{ type: "uint256", name: "ethOut" }, { type: "uint256", name: "fee" }],
  },
  {
    type: "event",
    name: "Buy",
    inputs: [
      { type: "address", name: "swapper", indexed: true },
      { type: "uint256", name: "ethIn" },
      { type: "uint256", name: "fee" },
      { type: "uint256", name: "ascendOut" },
      { type: "uint256", name: "newFloor" },
    ],
  },
  {
    type: "event",
    name: "Sell",
    inputs: [
      { type: "address", name: "swapper", indexed: true },
      { type: "uint256", name: "ascendIn" },
      { type: "uint256", name: "fee" },
      { type: "uint256", name: "ethOut" },
      { type: "uint256", name: "newFloor" },
    ],
  },
] as const;

export const ASCEND_ROUTER_ABI = [
  {
    type: "function",
    name: "buy",
    stateMutability: "payable",
    inputs: [
      { type: "uint256", name: "minOut" },
      { type: "address", name: "recipient" },
    ],
    outputs: [{ type: "uint256", name: "ascendOut" }],
  },
  {
    type: "function",
    name: "sell",
    stateMutability: "nonpayable",
    inputs: [
      { type: "uint256", name: "ascendIn" },
      { type: "uint256", name: "minOut" },
      { type: "address", name: "recipient" },
    ],
    outputs: [{ type: "uint256", name: "ethOut" }],
  },
] as const;

export const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [{ type: "address" }, { type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
] as const;

/// V2 hook ABI — minimal surface the dapp consumes.
export const ASCEND_HOOK_V2_ABI = [
  { type: "function", name: "ascend", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "tileEngine", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "floor", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "liquidityHeld", stateMutability: "view", inputs: [], outputs: [{ type: "uint128" }] },
  { type: "function", name: "isInitialized", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "rebalance", stateMutability: "nonpayable", inputs: [], outputs: [] },
] as const;

/// V3 hook ABI — Sato-style bonding curve. Surface the dapp reads.
export const ASCEND_HOOK_V3_ABI = [
  { type: "function", name: "ascend", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "tileEngine", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "isInitialized", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "currentSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "cumulativeEthIn", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "mintedFair", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "forwardSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "drift", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "reserveEth", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "floor", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "spotPrice", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "tileAccrual", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "K", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "S", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "quoteMint",
    stateMutability: "view",
    inputs: [{ type: "uint256", name: "ethIn" }],
    outputs: [{ type: "uint256", name: "mintAmount" }, { type: "uint256", name: "totalFee" }],
  },
  {
    type: "function",
    name: "quoteBurn",
    stateMutability: "view",
    inputs: [{ type: "uint256", name: "satoIn" }],
    outputs: [{ type: "uint256", name: "ethOut" }, { type: "uint256", name: "totalFee" }],
  },
  { type: "function", name: "sweep", stateMutability: "nonpayable", inputs: [], outputs: [] },
  {
    type: "event",
    name: "Mint",
    inputs: [
      { type: "address", name: "sender", indexed: true },
      { type: "uint256", name: "ethIn" },
      { type: "uint256", name: "totalFee" },
      { type: "uint256", name: "tileShare" },
      { type: "uint256", name: "mintAmount" },
      { type: "uint256", name: "newEthCum" },
      { type: "uint256", name: "newSupply" },
    ],
  },
  {
    type: "event",
    name: "Burn",
    inputs: [
      { type: "address", name: "sender", indexed: true },
      { type: "uint256", name: "satoIn" },
      { type: "uint256", name: "totalFee" },
      { type: "uint256", name: "tileShare" },
      { type: "uint256", name: "ethOut" },
      { type: "uint256", name: "newEthCum" },
      { type: "uint256", name: "newSupply" },
    ],
  },
] as const;

/// TileEngine ABI for the claim flow.
export const TILE_ENGINE_ABI = [
  { type: "function", name: "currentEpoch", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "currentEpochPool", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "currentBaseReward", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "GRID_SIZE", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  { type: "function", name: "EPOCH_LENGTH", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "SELECTION_RATE_BPS", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "tileClaim",
    stateMutability: "view",
    inputs: [{ type: "uint16" }, { type: "uint64" }],
    outputs: [
      { type: "address", name: "claimer" },
      { type: "uint8", name: "multiplier" },
      { type: "uint128", name: "reward" },
    ],
  },
  {
    type: "function",
    name: "epochTiles",
    stateMutability: "view",
    inputs: [{ type: "uint64" }],
    outputs: [
      {
        type: "tuple[144]",
        components: [
          { type: "address", name: "claimer" },
          { type: "uint8", name: "multiplier" },
          { type: "uint128", name: "reward" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "currentEpochTiles",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        type: "tuple[144]",
        components: [
          { type: "address", name: "claimer" },
          { type: "uint8", name: "multiplier" },
          { type: "uint128", name: "reward" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "lastClaimEpoch",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint64" }],
  },
  {
    type: "function",
    name: "isTileAvailable",
    stateMutability: "view",
    inputs: [{ type: "uint16" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "canClaim",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "isSelected",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "uint64" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "claimTile",
    stateMutability: "nonpayable",
    inputs: [{ type: "uint16" }],
    outputs: [{ type: "uint8", name: "multiplier" }, { type: "uint256", name: "reward" }],
  },
  {
    type: "event",
    name: "TileClaimed",
    inputs: [
      { type: "address", name: "claimer", indexed: true },
      { type: "uint16", name: "tileIdx", indexed: true },
      { type: "uint64", name: "epoch", indexed: true },
      { type: "uint8", name: "multiplier" },
      { type: "uint256", name: "reward" },
    ],
  },
] as const;
