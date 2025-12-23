import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

/**
 * Examples:
 *   - npx hardhat --network sepolia task:address
 *   - npx hardhat --network sepolia task:create-vote --title "Best city" --options "NYC,Paris,Tokyo" --start 1735689600 --end 1735696800
 *   - npx hardhat --network sepolia task:vote --voteid 1 --option 0
 *   - npx hardhat --network sepolia task:request-results --voteid 1
 */

task("task:address", "Prints the InvisiVote address").setAction(async function (_taskArguments: TaskArguments, hre) {
  const { deployments } = hre;

  const invisivote = await deployments.get("InvisiVote");

  console.log("InvisiVote address is " + invisivote.address);
});

task("task:create-vote", "Creates a new vote")
  .addOptionalParam("address", "Optionally specify the InvisiVote contract address")
  .addParam("title", "Vote title")
  .addParam("options", "Comma-separated list of 2-4 options")
  .addParam("start", "Start time (unix seconds)")
  .addParam("end", "End time (unix seconds)")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments } = hre;

    const title = String(taskArguments.title);
    const options = String(taskArguments.options)
      .split(",")
      .map((option) => option.trim())
      .filter((option) => option.length > 0);
    const startTime = parseInt(taskArguments.start);
    const endTime = parseInt(taskArguments.end);

    const invisivoteDeployment = taskArguments.address
      ? { address: taskArguments.address }
      : await deployments.get("InvisiVote");

    const [signer] = await ethers.getSigners();
    const contract = await ethers.getContractAt("InvisiVote", invisivoteDeployment.address, signer);

    const tx = await contract.createVote(title, options, startTime, endTime);
    console.log(`Wait for tx:${tx.hash}...`);
    const receipt = await tx.wait();
    console.log(`tx:${tx.hash} status=${receipt?.status}`);
  });

task("task:vote", "Casts an encrypted vote")
  .addOptionalParam("address", "Optionally specify the InvisiVote contract address")
  .addParam("voteid", "Vote id")
  .addParam("option", "Option index")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments, fhevm } = hre;

    const voteId = parseInt(taskArguments.voteid);
    const optionIndex = parseInt(taskArguments.option);
    if (!Number.isInteger(optionIndex)) {
      throw new Error("Argument --option is not an integer");
    }

    await fhevm.initializeCLIApi();

    const invisivoteDeployment = taskArguments.address
      ? { address: taskArguments.address }
      : await deployments.get("InvisiVote");

    const [signer] = await ethers.getSigners();
    const contract = await ethers.getContractAt("InvisiVote", invisivoteDeployment.address, signer);

    const encryptedInput = await fhevm
      .createEncryptedInput(invisivoteDeployment.address, signer.address)
      .add32(optionIndex)
      .encrypt();

    const tx = await contract.castVote(voteId, encryptedInput.handles[0], encryptedInput.inputProof);
    console.log(`Wait for tx:${tx.hash}...`);
    const receipt = await tx.wait();
    console.log(`tx:${tx.hash} status=${receipt?.status}`);
  });

task("task:request-results", "Marks results as publicly decryptable")
  .addOptionalParam("address", "Optionally specify the InvisiVote contract address")
  .addParam("voteid", "Vote id")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments } = hre;

    const voteId = parseInt(taskArguments.voteid);
    const invisivoteDeployment = taskArguments.address
      ? { address: taskArguments.address }
      : await deployments.get("InvisiVote");

    const [signer] = await ethers.getSigners();
    const contract = await ethers.getContractAt("InvisiVote", invisivoteDeployment.address, signer);

    const tx = await contract.requestResultsDecryption(voteId);
    console.log(`Wait for tx:${tx.hash}...`);
    const receipt = await tx.wait();
    console.log(`tx:${tx.hash} status=${receipt?.status}`);
  });
