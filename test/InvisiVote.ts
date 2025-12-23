import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { ethers, fhevm } from "hardhat";
import { InvisiVote, InvisiVote__factory } from "../types";
import { expect } from "chai";

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
};

async function deployFixture() {
  const factory = (await ethers.getContractFactory("InvisiVote")) as InvisiVote__factory;
  const invisivoteContract = (await factory.deploy()) as InvisiVote;
  const invisivoteAddress = await invisivoteContract.getAddress();

  return { invisivoteContract, invisivoteAddress };
}

describe("InvisiVote", function () {
  let signers: Signers;
  let invisivoteContract: InvisiVote;
  let invisivoteAddress: string;

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2] };
  });

  beforeEach(async function () {
    // Check whether the tests are running against an FHEVM mock environment
    if (!fhevm.isMock) {
      console.warn(`This hardhat test suite cannot run on Sepolia Testnet`);
      this.skip();
    }

    ({ invisivoteContract, invisivoteAddress } = await deployFixture());
  });

  it("creates a vote with valid options", async function () {
    const now = await time.latest();
    const startTime = now + 60;
    const endTime = now + 3600;

    const tx = await invisivoteContract
      .connect(signers.alice)
      .createVote("Best Season", ["Spring", "Autumn", "Winter"], startTime, endTime);
    await tx.wait();

    const vote = await invisivoteContract.getVote(1);
    expect(vote.title).to.eq("Best Season");
    expect(vote.options.length).to.eq(3);
    expect(vote.startTime).to.eq(startTime);
    expect(vote.endTime).to.eq(endTime);
  });

  it("rejects invalid option count", async function () {
    const now = await time.latest();
    await expect(
      invisivoteContract
        .connect(signers.alice)
        .createVote("Invalid", ["OnlyOne"], now + 10, now + 100),
    ).to.be.revertedWithCustomError(invisivoteContract, "InvalidOptionsCount");
  });

  it("prevents voting before start time", async function () {
    const now = await time.latest();
    const startTime = now + 600;
    const endTime = now + 1200;

    await invisivoteContract
      .connect(signers.alice)
      .createVote("Lunch Option", ["Pizza", "Salad"], startTime, endTime);

    const encryptedChoice = await fhevm
      .createEncryptedInput(invisivoteAddress, signers.alice.address)
      .add32(0)
      .encrypt();

    await expect(
      invisivoteContract
        .connect(signers.alice)
        .castVote(1, encryptedChoice.handles[0], encryptedChoice.inputProof),
    ).to.be.revertedWithCustomError(invisivoteContract, "VotingNotStarted");
  });

  it("records a vote and blocks duplicate voting", async function () {
    const now = await time.latest();
    await invisivoteContract
      .connect(signers.alice)
      .createVote("Best Transport", ["Train", "Bike"], now - 10, now + 3600);

    const encryptedChoice = await fhevm
      .createEncryptedInput(invisivoteAddress, signers.alice.address)
      .add32(1)
      .encrypt();

    await invisivoteContract
      .connect(signers.alice)
      .castVote(1, encryptedChoice.handles[0], encryptedChoice.inputProof);

    expect(await invisivoteContract.hasVoted(1, signers.alice.address)).to.eq(true);

    await expect(
      invisivoteContract
        .connect(signers.alice)
        .castVote(1, encryptedChoice.handles[0], encryptedChoice.inputProof),
    ).to.be.revertedWithCustomError(invisivoteContract, "AlreadyVoted");
  });

  it("allows requesting decryption after voting ends", async function () {
    const now = await time.latest();
    const endTime = now + 60;

    await invisivoteContract
      .connect(signers.alice)
      .createVote("Future Event", ["Attend", "Skip"], now - 10, endTime);

    await time.increaseTo(endTime + 1);

    await invisivoteContract.connect(signers.bob).requestResultsDecryption(1);

    const vote = await invisivoteContract.getVote(1);
    expect(vote.decryptionRequested).to.eq(true);
  });

  it("rejects requesting decryption while voting is active", async function () {
    const now = await time.latest();
    const endTime = now + 600;

    await invisivoteContract
      .connect(signers.alice)
      .createVote("Coffee Break", ["Now", "Later"], now - 10, endTime);

    await expect(
      invisivoteContract.connect(signers.bob).requestResultsDecryption(1),
    ).to.be.revertedWithCustomError(invisivoteContract, "VotingStillActive");
  });
});
