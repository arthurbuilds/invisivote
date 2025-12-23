import { useEffect, useMemo, useState } from 'react';
import { Contract } from 'ethers';
import { useAccount, usePublicClient, useReadContract, useReadContracts } from 'wagmi';
import { Header } from './Header';
import { useEthersSigner } from '../hooks/useEthersSigner';
import { useZamaInstance } from '../hooks/useZamaInstance';
import { CONTRACT_ADDRESS, CONTRACT_ABI } from '../config/contracts';
import '../styles/VoteApp.css';

type VoteEntry = {
  id: number;
  title: string;
  options: string[];
  startTime: bigint;
  endTime: bigint;
  creator: string;
  decryptionRequested: boolean;
  resultsPublished: boolean;
};

type DecryptedResult = {
  counts: number[];
  proof: `0x${string}`;
  handles: `0x${string}`[];
};

const emptyOptions = ['', '', '', ''];
const PLACEHOLDER_ADDRESS = '0x0000000000000000000000000000000000000000';

function toUnixTimestamp(input: string): number | null {
  const ms = Date.parse(input);
  if (Number.isNaN(ms)) {
    return null;
  }
  return Math.floor(ms / 1000);
}

function formatTimestamp(timestamp: bigint): string {
  const value = Number(timestamp) * 1000;
  if (!Number.isFinite(value)) {
    return 'N/A';
  }
  return new Date(value).toLocaleString();
}

function getStatus(vote: VoteEntry, now: number) {
  const start = Number(vote.startTime);
  const end = Number(vote.endTime);
  const isUpcoming = now < start;
  const isEnded = now > end;
  const isActive = !isUpcoming && !isEnded;

  if (isUpcoming) {
    return { label: 'Upcoming', tone: 'status-upcoming', isActive, isEnded, isUpcoming };
  }
  if (isEnded) {
    return { label: 'Ended', tone: 'status-ended', isActive, isEnded, isUpcoming };
  }
  return { label: 'Live', tone: 'status-live', isActive, isEnded, isUpcoming };
}

export function VoteApp() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const signerPromise = useEthersSigner();
  const { instance, isLoading: zamaLoading, error: zamaError } = useZamaInstance();

  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [title, setTitle] = useState('');
  const [optionInputs, setOptionInputs] = useState<string[]>([...emptyOptions]);
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [selectedOptions, setSelectedOptions] = useState<Record<number, number>>({});
  const [decryptingVoteId, setDecryptingVoteId] = useState<number | null>(null);
  const [publishingVoteId, setPublishingVoteId] = useState<number | null>(null);
  const [castingVoteId, setCastingVoteId] = useState<number | null>(null);
  const [finalizingVoteId, setFinalizingVoteId] = useState<number | null>(null);
  const [decryptedResults, setDecryptedResults] = useState<Record<number, DecryptedResult>>({});

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Math.floor(Date.now() / 1000));
    }, 15000);
    return () => window.clearInterval(timer);
  }, []);

  const { data: voteCount, refetch: refetchVoteCount } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'getVoteCount',
  });

  const voteIds = useMemo(() => {
    const count = voteCount ? Number(voteCount) : 0;
    return Array.from({ length: count }, (_, index) => BigInt(index + 1));
  }, [voteCount]);

  const { data: voteData, refetch: refetchVotes } = useReadContracts({
    contracts: voteIds.map((id) => ({
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: 'getVote',
      args: [id],
    })),
    query: {
      enabled: voteIds.length > 0,
    },
  });

  const votes = useMemo<VoteEntry[]>(() => {
    if (!voteData) {
      return [];
    }

    return voteData
      .map((entry, index) => {
        if (!entry.result) {
          return null;
        }
        const [voteTitle, options, startTime, endTime, creator, decryptionRequested, resultsPublished] =
          entry.result as unknown as [string, string[], bigint, bigint, string, boolean, boolean];
        return {
          id: Number(voteIds[index]),
          title: voteTitle,
          options,
          startTime,
          endTime,
          creator,
          decryptionRequested,
          resultsPublished,
        };
      })
      .filter((vote): vote is VoteEntry => vote !== null)
      .sort((a, b) => b.id - a.id);
  }, [voteData, voteIds]);

  const { data: hasVotedData } = useReadContracts({
    contracts: address
      ? voteIds.map((id) => ({
          address: CONTRACT_ADDRESS,
          abi: CONTRACT_ABI,
          functionName: 'hasVoted',
          args: [id, address],
        }))
      : [],
    query: {
      enabled: !!address && voteIds.length > 0,
    },
  });

  const hasVotedMap = useMemo(() => {
    const map: Record<number, boolean> = {};
    if (!hasVotedData) {
      return map;
    }
    hasVotedData.forEach((entry, index) => {
      map[Number(voteIds[index])] = Boolean(entry.result);
    });
    return map;
  }, [hasVotedData, voteIds]);

  const publishedVoteIds = useMemo(
    () => votes.filter((vote) => vote.resultsPublished).map((vote) => BigInt(vote.id)),
    [votes],
  );

  const { data: publicResultsData } = useReadContracts({
    contracts: publishedVoteIds.map((id) => ({
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: 'getPublicResults',
      args: [id],
    })),
    query: {
      enabled: publishedVoteIds.length > 0,
    },
  });

  const publicResultsMap = useMemo(() => {
    const map: Record<number, number[]> = {};
    if (!publicResultsData) {
      return map;
    }
    publicResultsData.forEach((entry, index) => {
      const results = (entry.result as bigint[] | undefined) ?? [];
      map[Number(publishedVoteIds[index])] = results.map((value) => Number(value));
    });
    return map;
  }, [publicResultsData, publishedVoteIds]);

  const totalVotes = votes.length;
  const liveVotes = votes.filter((vote) => {
    const status = getStatus(vote, now);
    return status.isActive;
  }).length;

  const handleCreateVote = async () => {
    setNotice(null);
    if (CONTRACT_ADDRESS === PLACEHOLDER_ADDRESS) {
      setNotice({ type: 'error', text: 'Update the contract address before creating a vote.' });
      return;
    }

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setNotice({ type: 'error', text: 'Please enter a vote title.' });
      return;
    }

    const options = optionInputs.map((option) => option.trim()).filter((option) => option.length > 0);
    if (options.length < 2 || options.length > 4) {
      setNotice({ type: 'error', text: 'Please provide between 2 and 4 options.' });
      return;
    }

    const startTime = toUnixTimestamp(startAt);
    const endTime = toUnixTimestamp(endAt);
    if (!startTime || !endTime) {
      setNotice({ type: 'error', text: 'Start and end time are required.' });
      return;
    }
    if (endTime <= startTime) {
      setNotice({ type: 'error', text: 'End time must be after the start time.' });
      return;
    }
    if (endTime <= now) {
      setNotice({ type: 'error', text: 'End time must be in the future.' });
      return;
    }

    if (!signerPromise) {
      setNotice({ type: 'error', text: 'Connect your wallet to create a vote.' });
      return;
    }

    try {
      setCreating(true);
      const signer = await signerPromise;
      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      const tx = await contract.createVote(trimmedTitle, options, startTime, endTime);
      await tx.wait();

      setNotice({ type: 'success', text: 'Vote created successfully.' });
      setTitle('');
      setOptionInputs([...emptyOptions]);
      setStartAt('');
      setEndAt('');
      await Promise.all([refetchVoteCount(), refetchVotes()]);
    } catch (error) {
      console.error('Create vote error:', error);
      setNotice({ type: 'error', text: 'Failed to create vote. Please try again.' });
    } finally {
      setCreating(false);
    }
  };

  const handleCastVote = async (voteId: number) => {
    setNotice(null);
    if (CONTRACT_ADDRESS === PLACEHOLDER_ADDRESS) {
      setNotice({ type: 'error', text: 'Update the contract address before voting.' });
      return;
    }
    if (!address) {
      setNotice({ type: 'error', text: 'Connect your wallet to cast a vote.' });
      return;
    }
    if (!instance || !signerPromise) {
      setNotice({ type: 'error', text: 'Encryption services are still loading.' });
      return;
    }

    const selected = selectedOptions[voteId];
    if (selected === undefined) {
      setNotice({ type: 'error', text: 'Select an option before voting.' });
      return;
    }

    try {
      setCastingVoteId(voteId);
      const encryptedInput = await instance
        .createEncryptedInput(CONTRACT_ADDRESS, address)
        .add32(selected)
        .encrypt();

      const signer = await signerPromise;
      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      const tx = await contract.castVote(voteId, encryptedInput.handles[0], encryptedInput.inputProof);
      await tx.wait();

      setNotice({ type: 'success', text: 'Vote submitted and encrypted.' });
      await refetchVotes();
    } catch (error) {
      console.error('Cast vote error:', error);
      setNotice({ type: 'error', text: 'Failed to submit vote.' });
    } finally {
      setCastingVoteId(null);
    }
  };

  const handleRequestResults = async (voteId: number) => {
    setNotice(null);
    if (CONTRACT_ADDRESS === PLACEHOLDER_ADDRESS) {
      setNotice({ type: 'error', text: 'Update the contract address before requesting results.' });
      return;
    }
    if (!signerPromise) {
      setNotice({ type: 'error', text: 'Connect your wallet to request decryption.' });
      return;
    }
    try {
      setFinalizingVoteId(voteId);
      const signer = await signerPromise;
      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      const tx = await contract.requestResultsDecryption(voteId);
      await tx.wait();
      setNotice({ type: 'success', text: 'Results are now publicly decryptable.' });
      await refetchVotes();
    } catch (error) {
      console.error('Request results error:', error);
      setNotice({ type: 'error', text: 'Failed to request decryption.' });
    } finally {
      setFinalizingVoteId(null);
    }
  };

  const handleDecryptResults = async (voteId: number) => {
    setNotice(null);
    if (CONTRACT_ADDRESS === PLACEHOLDER_ADDRESS) {
      setNotice({ type: 'error', text: 'Update the contract address before decrypting results.' });
      return;
    }
    if (!instance) {
      setNotice({ type: 'error', text: 'Encryption services are still loading.' });
      return;
    }
    if (!publicClient) {
      setNotice({ type: 'error', text: 'Public client is not available.' });
      return;
    }
    try {
      setDecryptingVoteId(voteId);
      const encryptedCounts = (await publicClient.readContract({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: 'getEncryptedCounts',
        args: [BigInt(voteId)],
      })) as `0x${string}`[];

      const handles = encryptedCounts as `0x${string}`[];
      const result = await instance.publicDecrypt(handles);

      const counts = handles.map((handle) => {
        const rawValue = result.clearValues[handle];
        if (typeof rawValue === 'bigint') {
          return Number(rawValue);
        }
        if (typeof rawValue === 'number') {
          return rawValue;
        }
        return Number.parseInt(String(rawValue), 10);
      });
      setDecryptedResults((prev) => ({
        ...prev,
        [voteId]: {
          counts,
          proof: result.decryptionProof,
          handles,
        },
      }));
      setNotice({ type: 'success', text: 'Results decrypted locally. Ready to publish.' });
    } catch (error) {
      console.error('Decrypt results error:', error);
      setNotice({ type: 'error', text: 'Failed to decrypt results.' });
    } finally {
      setDecryptingVoteId(null);
    }
  };

  const handlePublishResults = async (voteId: number) => {
    setNotice(null);
    if (CONTRACT_ADDRESS === PLACEHOLDER_ADDRESS) {
      setNotice({ type: 'error', text: 'Update the contract address before publishing results.' });
      return;
    }
    if (!signerPromise) {
      setNotice({ type: 'error', text: 'Connect your wallet to publish results.' });
      return;
    }
    const cached = decryptedResults[voteId];
    if (!cached) {
      setNotice({ type: 'error', text: 'Decrypt results before publishing.' });
      return;
    }

    try {
      setPublishingVoteId(voteId);
      const signer = await signerPromise;
      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      const tx = await contract.publishResults(voteId, cached.counts, cached.proof);
      await tx.wait();
      setNotice({ type: 'success', text: 'Results published on-chain.' });
      await refetchVotes();
    } catch (error) {
      console.error('Publish results error:', error);
      setNotice({ type: 'error', text: 'Failed to publish results.' });
    } finally {
      setPublishingVoteId(null);
    }
  };

  return (
    <div className="vote-app">
      <Header />
      <main className="vote-main">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">Encrypted governance - Zama FHE</p>
            <h2 className="hero-title">Run private votes, reveal results only when the clock runs out.</h2>
            <p className="hero-subtitle">
              InvisiVote keeps every ballot encrypted, then opens the tally for public verification when the poll ends.
            </p>
          </div>
          <div className="hero-stats">
            <div>
              <p className="stat-label">Total votes</p>
              <p className="stat-value">{totalVotes}</p>
            </div>
            <div>
              <p className="stat-label">Live now</p>
              <p className="stat-value">{liveVotes}</p>
            </div>
            <div>
              <p className="stat-label">Network</p>
              <p className="stat-value">Sepolia</p>
            </div>
          </div>
        </section>

        {notice && (
          <div className={`notice notice-${notice.type}`}>
            <span>{notice.text}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notice">
              x
            </button>
          </div>
        )}

        <section className="grid">
          <div className="panel create-panel">
            <h3>Create a vote</h3>
            <p className="panel-subtitle">Define the options, schedule the window, and launch.</p>
            <div className="form-grid">
              <label className="field">
                <span>Vote title</span>
                <input
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="e.g. Next quarterly focus"
                />
              </label>
              <div className="field-group">
                <span>Options (2-4)</span>
                <div className="option-grid">
                  {optionInputs.map((option, index) => (
                    <input
                      key={`option-${index}`}
                      type="text"
                      value={option}
                      onChange={(event) => {
                        const next = [...optionInputs];
                        next[index] = event.target.value;
                        setOptionInputs(next);
                      }}
                      placeholder={`Option ${index + 1}`}
                    />
                  ))}
                </div>
              </div>
              <label className="field">
                <span>Start time</span>
                <input type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} />
              </label>
              <label className="field">
                <span>End time</span>
                <input type="datetime-local" value={endAt} onChange={(event) => setEndAt(event.target.value)} />
              </label>
            </div>
            <button className="primary-button" type="button" onClick={handleCreateVote} disabled={creating}>
              {creating ? 'Creating vote...' : 'Launch encrypted vote'}
            </button>
            <div className="panel-footnote">
              {zamaLoading ? 'Connecting to Zama relayer...' : zamaError ? zamaError : 'Zama relayer ready.'}
            </div>
          </div>

          <div className="panel board-panel">
            <div className="panel-header">
              <div>
                <h3>Active board</h3>
                <p className="panel-subtitle">Vote, decrypt, and publish results without leaking ballots.</p>
              </div>
              <div className="panel-pill">On-chain polls: {totalVotes}</div>
            </div>

            {votes.length === 0 && (
              <div className="empty-state">
                <p>No votes yet. Create the first encrypted ballot to get started.</p>
              </div>
            )}

            <div className="vote-list">
              {votes.map((vote) => {
                const status = getStatus(vote, now);
                const hasVoted = hasVotedMap[vote.id];
                const localResults = decryptedResults[vote.id];
                const publishedResults = publicResultsMap[vote.id];

                return (
                  <article key={`vote-${vote.id}`} className="vote-card">
                    <div className="vote-header">
                      <div>
                        <p className={`status-pill ${status.tone}`}>{status.label}</p>
                        <h4>{vote.title}</h4>
                      </div>
                      <div className="vote-meta">
                        <span>#{vote.id}</span>
                        <span>{vote.options.length} options</span>
                      </div>
                    </div>
                    <div className="vote-timings">
                      <div>
                        <p>Starts</p>
                        <span>{formatTimestamp(vote.startTime)}</span>
                      </div>
                      <div>
                        <p>Ends</p>
                        <span>{formatTimestamp(vote.endTime)}</span>
                      </div>
                    </div>

                    <div className="vote-options">
                      {vote.options.map((option, optionIndex) => (
                        <label key={`${vote.id}-option-${optionIndex}`} className="option-row">
                          <input
                            type="radio"
                            name={`vote-${vote.id}`}
                            disabled={!status.isActive || hasVoted}
                            checked={selectedOptions[vote.id] === optionIndex}
                            onChange={() =>
                              setSelectedOptions((prev) => ({ ...prev, [vote.id]: optionIndex }))
                            }
                          />
                          <span>{option}</span>
                        </label>
                      ))}
                    </div>

                    <div className="vote-actions">
                      {status.isActive && (
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={hasVoted || castingVoteId === vote.id}
                          onClick={() => handleCastVote(vote.id)}
                        >
                          {hasVoted ? 'Vote submitted' : castingVoteId === vote.id ? 'Encrypting vote...' : 'Submit vote'}
                        </button>
                      )}

                      {status.isEnded && !vote.decryptionRequested && (
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => handleRequestResults(vote.id)}
                          disabled={finalizingVoteId === vote.id}
                        >
                          {finalizingVoteId === vote.id ? 'Requesting...' : 'Request public decryption'}
                        </button>
                      )}

                      {status.isEnded && vote.decryptionRequested && !vote.resultsPublished && (
                        <div className="stacked-actions">
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => handleDecryptResults(vote.id)}
                            disabled={decryptingVoteId === vote.id}
                          >
                            {decryptingVoteId === vote.id ? 'Decrypting...' : 'Decrypt results'}
                          </button>
                          <button
                            type="button"
                            className="primary-button"
                            onClick={() => handlePublishResults(vote.id)}
                            disabled={publishingVoteId === vote.id}
                          >
                            {publishingVoteId === vote.id ? 'Publishing...' : 'Publish results on-chain'}
                          </button>
                        </div>
                      )}
                    </div>

                    {(localResults || publishedResults) && (
                      <div className="results-panel">
                        <h5>{vote.resultsPublished ? 'On-chain results' : 'Decrypted results (local)'}</h5>
                        <div className="results-grid">
                          {vote.options.map((option, optionIndex) => {
                            const value = vote.resultsPublished
                              ? publishedResults?.[optionIndex]
                              : localResults?.counts[optionIndex];
                            return (
                              <div key={`${vote.id}-result-${optionIndex}`} className="result-card">
                                <span>{option}</span>
                                <strong>{value ?? '-'}</strong>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {!status.isActive && !status.isEnded && (
                      <p className="hint">Voting opens soon. Come back at the start time to cast a ballot.</p>
                    )}
                    {status.isEnded && !vote.decryptionRequested && (
                      <p className="hint">Voting closed. Anyone can request public decryption now.</p>
                    )}
                    {vote.resultsPublished && (
                      <p className="hint">Results stored on-chain with verified decryption proof.</p>
                    )}
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
