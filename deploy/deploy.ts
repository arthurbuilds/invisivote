import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const deployedInvisiVote = await deploy("InvisiVote", {
    from: deployer,
    log: true,
  });

  console.log(`InvisiVote contract: `, deployedInvisiVote.address);
};
export default func;
func.id = "deploy_invisivote"; // id required to prevent reexecution
func.tags = ["InvisiVote"];
