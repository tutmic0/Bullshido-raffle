const { ethers } = require("ethers");

// Robinhood Chain mainnet (Arbitrum Orbit L2) -- same public chain the
// Bullshido collection mints on. Chain ID 4663.
const DEFAULT_RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
const CHAIN_ID = 4663;

const ERC721_MINIMAL_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
];

function getProvider() {
  const rpcUrl = process.env.ROBINHOOD_RPC_URL || DEFAULT_RPC_URL;
  return new ethers.JsonRpcProvider(rpcUrl, CHAIN_ID);
}

function getContract() {
  const address = process.env.CONTRACT_ADDRESS;
  if (!address) {
    throw new Error("Missing CONTRACT_ADDRESS environment variable.");
  }
  return new ethers.Contract(address, ERC721_MINIMAL_ABI, getProvider());
}

/// The number of raffle tickets a wallet gets is exactly its current
/// Bullshido balance -- read live from the chain, never trusted from
/// the client. Returns a plain JS number (collection is 2,112 total,
/// nowhere near large enough to need BigInt beyond this point).
async function getBullshidoBalance(wallet) {
  const contract = getContract();
  const balance = await contract.balanceOf(wallet);
  return Number(balance);
}

module.exports = { getProvider, getContract, getBullshidoBalance, CHAIN_ID };
