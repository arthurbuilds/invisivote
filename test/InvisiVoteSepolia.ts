import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm, deployments } from "hardhat";
import { InvisiVote } from "../types";
import { expect } from "chai";

type Signers = {
  alice: HardhatEthersSigner;
};

describe("InvisiVoteSepolia", function () {
  let signers: Signers;
  let invisivoteContract: InvisiVote;
  let invisivoteAddress: string;

  before(async function () {
    if (fhevm.isMock) {
      console.warn(`This hardhat test suite can only run on Sepolia Testnet`);
      this.skip();
    }

    try {
      const invisivoteDeployment = await deployments.get("InvisiVote");
      invisivoteAddress = invisivoteDeployment.address;
      invisivoteContract = await ethers.getContractAt("InvisiVote", invisivoteDeployment.address);
    } catch (e) {
      (e as Error).message += ". Call 'npx hardhat deploy --network sepolia'";
      throw e;
    }

    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { alice: ethSigners[0] };
  });

  it("reads the deployed contract metadata", async function () {
    this.timeout(2 * 40000);

    const totalVotes = await invisivoteContract.getVoteCount();
    expect(totalVotes).to.be.gte(0);

    expect(invisivoteAddress).to.match(/^0x[a-fA-F0-9]{40}$/);
  });
});
