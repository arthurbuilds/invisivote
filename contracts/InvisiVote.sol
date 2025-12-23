// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, ebool, euint32, externalEuint32} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title InvisiVote
/// @notice Encrypted voting with public decryption after the voting window ends.
contract InvisiVote is ZamaEthereumConfig {
    struct Vote {
        string title;
        string[] options;
        uint64 startTime;
        uint64 endTime;
        address creator;
        bool decryptionRequested;
        bool resultsPublished;
        euint32[] encryptedCounts;
        uint32[] publicResults;
    }

    uint256 private _voteCount;
    mapping(uint256 => Vote) private _votes;
    mapping(uint256 => mapping(address => bool)) private _hasVoted;

    event VoteCreated(uint256 indexed voteId, address indexed creator, string title, uint64 startTime, uint64 endTime);
    event VoteCast(uint256 indexed voteId, address indexed voter);
    event ResultsDecryptionRequested(uint256 indexed voteId);
    event ResultsPublished(uint256 indexed voteId);

    error VoteNotFound(uint256 voteId);
    error InvalidOptionsCount(uint256 count);
    error InvalidTimeRange(uint64 startTime, uint64 endTime);
    error VotingNotStarted(uint256 voteId);
    error VotingStillActive(uint256 voteId);
    error VotingEnded(uint256 voteId);
    error AlreadyVoted(uint256 voteId, address voter);
    error DecryptionAlreadyRequested(uint256 voteId);
    error ResultsNotReady(uint256 voteId);
    error ResultsAlreadyPublished(uint256 voteId);
    error InvalidResultsLength(uint256 expected, uint256 actual);

    function createVote(
        string calldata title,
        string[] calldata options,
        uint64 startTime,
        uint64 endTime
    ) external returns (uint256 voteId) {
        if (options.length < 2 || options.length > 4) {
            revert InvalidOptionsCount(options.length);
        }
        if (endTime <= startTime || endTime <= uint64(block.timestamp)) {
            revert InvalidTimeRange(startTime, endTime);
        }

        voteId = ++_voteCount;
        Vote storage vote = _votes[voteId];
        vote.title = title;
        vote.startTime = startTime;
        vote.endTime = endTime;
        vote.creator = msg.sender;

        for (uint256 i = 0; i < options.length; i++) {
            vote.options.push(options[i]);
            euint32 zero = FHE.asEuint32(0);
            vote.encryptedCounts.push(zero);
            FHE.allowThis(vote.encryptedCounts[i]);
        }

        emit VoteCreated(voteId, msg.sender, title, startTime, endTime);
    }

    function castVote(uint256 voteId, externalEuint32 encryptedChoice, bytes calldata inputProof) external {
        Vote storage vote = _getVote(voteId);
        if (block.timestamp < vote.startTime) {
            revert VotingNotStarted(voteId);
        }
        if (block.timestamp > vote.endTime) {
            revert VotingEnded(voteId);
        }
        if (_hasVoted[voteId][msg.sender]) {
            revert AlreadyVoted(voteId, msg.sender);
        }

        _hasVoted[voteId][msg.sender] = true;

        euint32 choice = FHE.fromExternal(encryptedChoice, inputProof);
        uint256 optionCount = vote.options.length;

        for (uint256 i = 0; i < optionCount; i++) {
            ebool isSelected = FHE.eq(choice, FHE.asEuint32(uint32(i)));
            euint32 increment = FHE.select(isSelected, FHE.asEuint32(1), FHE.asEuint32(0));
            vote.encryptedCounts[i] = FHE.add(vote.encryptedCounts[i], increment);
            FHE.allowThis(vote.encryptedCounts[i]);
        }

        emit VoteCast(voteId, msg.sender);
    }

    function requestResultsDecryption(uint256 voteId) external {
        Vote storage vote = _getVote(voteId);
        if (block.timestamp <= vote.endTime) {
            revert VotingStillActive(voteId);
        }
        if (vote.decryptionRequested) {
            revert DecryptionAlreadyRequested(voteId);
        }

        vote.decryptionRequested = true;
        for (uint256 i = 0; i < vote.encryptedCounts.length; i++) {
            FHE.makePubliclyDecryptable(vote.encryptedCounts[i]);
        }

        emit ResultsDecryptionRequested(voteId);
    }

    function publishResults(uint256 voteId, uint32[] calldata clearCounts, bytes calldata decryptionProof) external {
        Vote storage vote = _getVote(voteId);
        if (!vote.decryptionRequested) {
            revert ResultsNotReady(voteId);
        }
        if (vote.resultsPublished) {
            revert ResultsAlreadyPublished(voteId);
        }
        if (clearCounts.length != vote.options.length) {
            revert InvalidResultsLength(vote.options.length, clearCounts.length);
        }

        bytes32[] memory handles = new bytes32[](clearCounts.length);
        for (uint256 i = 0; i < clearCounts.length; i++) {
            handles[i] = euint32.unwrap(vote.encryptedCounts[i]);
        }

        bytes memory cleartexts = abi.encode(clearCounts);
        FHE.checkSignatures(handles, cleartexts, decryptionProof);

        vote.publicResults = clearCounts;
        vote.resultsPublished = true;

        emit ResultsPublished(voteId);
    }

    function getVoteCount() external view returns (uint256) {
        return _voteCount;
    }

    function getVote(
        uint256 voteId
    )
        external
        view
        returns (
            string memory title,
            string[] memory options,
            uint64 startTime,
            uint64 endTime,
            address creator,
            bool decryptionRequested,
            bool resultsPublished
        )
    {
        Vote storage vote = _getVote(voteId);
        return (
            vote.title,
            vote.options,
            vote.startTime,
            vote.endTime,
            vote.creator,
            vote.decryptionRequested,
            vote.resultsPublished
        );
    }

    function getEncryptedCounts(uint256 voteId) external view returns (euint32[] memory) {
        Vote storage vote = _getVote(voteId);
        return vote.encryptedCounts;
    }

    function getPublicResults(uint256 voteId) external view returns (uint32[] memory) {
        Vote storage vote = _getVote(voteId);
        if (!vote.resultsPublished) {
            revert ResultsNotReady(voteId);
        }
        return vote.publicResults;
    }

    function hasVoted(uint256 voteId, address voter) external view returns (bool) {
        _getVote(voteId);
        return _hasVoted[voteId][voter];
    }

    function _getVote(uint256 voteId) internal view returns (Vote storage) {
        if (voteId == 0 || voteId > _voteCount) {
            revert VoteNotFound(voteId);
        }
        return _votes[voteId];
    }
}
