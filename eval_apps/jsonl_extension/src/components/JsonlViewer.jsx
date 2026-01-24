import React, { useState, useEffect, useRef, useCallback } from 'react';

// Debounce helper
const useDebounce = (callback, delay) => {
    const timeoutRef = useRef(null);
    useEffect(() => {
        return () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, []);

    const debouncedCallback = useCallback((...args) => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => {
            callback(...args);
        }, delay);
    }, [callback, delay]);

    return debouncedCallback;
};

const JsonlViewer = () => {
    const [entries, setEntries] = useState([]);
    const [currentFileHandle, setCurrentFileHandle] = useState(null); // The input file handle (for name reference)
    const [outputFileHandle, setOutputFileHandle] = useState(null);   // The _annotated file handle (for writing)
    const [currentIndex, setCurrentIndex] = useState(0);
    const [annotations, setAnnotations] = useState({}); // Map index -> annotation object
    const [dirHandle, setDirHandle] = useState(null);
    const [fileList, setFileList] = useState([]);
    const [loading, setLoading] = useState(false);
    const [saveStatus, setSaveStatus] = useState(''); // 'saving', 'saved', 'error'

    // Telemetry fields to hide/minimize
    const TELEMETRY_KEYS = [
        'input_mutation_id', 'timestamp', 'model', 'response_id',
        'input_tokens', 'output_tokens', 'cached_tokens',
        'web_search_calls', 'total_cost', 'duration_seconds', 'status', 'user_annotations'
    ];

    // Helper to read file handle text
    const readFileText = async (handle) => {
        const file = await handle.getFile();
        return await file.text();
    };

    // Helper to write text to file handle
    const writeFileText = async (handle, text) => {
        const writable = await handle.createWritable();
        await writable.write(text);
        await writable.close();
    };

    const handleOpenFolder = async () => {
        try {
            const handle = await window.showDirectoryPicker();
            setDirHandle(handle);
            await refreshFileList(handle);
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error("Error opening folder:", err);
                alert("Failed to open folder. See console.");
            }
        }
    };

    const refreshFileList = async (handle) => {
        if (!handle) return;
        const files = [];
        for await (const entry of handle.values()) {
            if (entry.kind === 'file' && entry.name.endsWith('.jsonl')) {
                // exclude _annotated files from the main list to keep it clean
                if (!entry.name.endsWith('_annotated.jsonl')) {
                    files.push(entry);
                }
            }
        }
        files.sort((a, b) => a.name.localeCompare(b.name));
        setFileList(files);
    };

    const initializeAnnotations = (originalObj) => {
        const newAnnot = {};
        Object.keys(originalObj).forEach(key => {
            if (!TELEMETRY_KEYS.includes(key)) {
                newAnnot[key] = { correctness: 'unchecked', comment: '' };
            }
        });
        return newAnnot;
    };

    const handleSelectFile = async (fileHandle) => {
        setLoading(true);
        setEntries([]);
        setAnnotations({});
        setCurrentIndex(0);
        setCurrentFileHandle(fileHandle);
        setSaveStatus('');

        try {
            const inputFilename = fileHandle.name;
            const outputFilename = inputFilename.replace('.jsonl', '_annotated.jsonl');

            let targetHandle;
            let fileContent = "";
            let isNew = false;

            // Check if output file exists
            try {
                targetHandle = await dirHandle.getFileHandle(outputFilename);
                // If successful, read from it
                fileContent = await readFileText(targetHandle);
            } catch (err) {
                if (err.name === 'NotFoundError') {
                    // Create it
                    isNew = true;
                    targetHandle = await dirHandle.getFileHandle(outputFilename, { create: true });
                    // Read original file to initialize
                    fileContent = await readFileText(fileHandle);
                } else {
                    throw err;
                }
            }

            setOutputFileHandle(targetHandle);

            const lines = fileContent.split('\n');
            const parsedEntries = [];
            const loadedAnnotations = {};

            lines.forEach((line, idx) => {
                if (line.trim()) {
                    try {
                        let obj = JSON.parse(line);
                        
                        if (isNew) {
                            // Initialize placeholders if creating new file
                            if (!obj.user_annotations) {
                                obj.user_annotations = initializeAnnotations(obj);
                            }
                        }

                        if (obj.user_annotations) {
                            loadedAnnotations[parsedEntries.length] = obj.user_annotations;
                        }
                        parsedEntries.push(obj);
                    } catch (err) {
                        console.error(`Error parsing line ${idx}:`, err);
                    }
                }
            });

            setEntries(parsedEntries);
            setAnnotations(loadedAnnotations);

            // If it was new, we need to write the initialized content immediately
            if (isNew) {
                await saveToDisk(targetHandle, parsedEntries, loadedAnnotations);
            }

        } catch (err) {
            console.error("Error loading file:", err);
            alert("Error loading file. " + err.message);
        } finally {
            setLoading(false);
        }
    };

    const saveToDisk = async (handle, currentEntries, currentAnnotations) => {
        if (!handle) return;
        try {
            setSaveStatus('saving...');
            const outputLines = currentEntries.map((entry, idx) => {
                const entryAnnot = currentAnnotations[idx];
                const newEntry = { ...entry };
                if (entryAnnot) {
                    newEntry.user_annotations = entryAnnot;
                }
                return JSON.stringify(newEntry);
            }).join('\n');
            
            await writeFileText(handle, outputLines);
            setSaveStatus('saved');
            setTimeout(() => setSaveStatus(''), 2000);
        } catch (err) {
            console.error("Save error:", err);
            setSaveStatus('error');
        }
    };

    const debouncedSave = useDebounce((handle, ents, annots) => {
        saveToDisk(handle, ents, annots);
    }, 500);

    const handleAnnotationChange = (key, field, value) => {
        setAnnotations(prev => {
            const currentEntryAnnots = prev[currentIndex] || {};
            const fieldAnnot = currentEntryAnnots[key] || { correctness: 'unchecked', comment: '' };

            const newAnnotations = {
                ...prev,
                [currentIndex]: {
                    ...currentEntryAnnots,
                    [key]: { ...fieldAnnot, [field]: value }
                }
            };
            
            // Trigger auto-save
            if (outputFileHandle) {
                debouncedSave(outputFileHandle, entries, newAnnotations);
            }
            
            return newAnnotations;
        });
    };

    const handleUrlClick = (url) => {
        if (chrome && chrome.tabs) {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs.length > 0) {
                    chrome.tabs.update(tabs[0].id, { url: url });
                } else {
                    chrome.tabs.create({ url: url });
                }
            });
        } else {
            window.open(url, '_blank');
        }
    };

    const nextEntry = () => {
        if (currentIndex < entries.length - 1) setCurrentIndex(prev => prev + 1);
    };

    const prevEntry = () => {
        if (currentIndex > 0) setCurrentIndex(prev => prev - 1);
    };

    // Helper to render text with clickable links
    const renderContent = (text) => {
        if (typeof text !== 'string') return String(text);
        const parts = [];
        let lastIndex = 0;
        const regex = /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)|(https?:\/\/[^\s]+)/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
            if (match.index > lastIndex) {
                parts.push(text.substring(lastIndex, match.index));
            }
            const url = match[2] || match[3];
            const label = match[1] || url;
            parts.push(
                <span
                    key={match.index}
                    style={{ color: 'blue', textDecoration: 'underline', cursor: 'pointer', margin: '0 2px' }}
                    onClick={() => handleUrlClick(url)}
                    title={url}
                >
                    {label} 🔗
                </span>
            );
            lastIndex = regex.lastIndex;
        }
        if (lastIndex < text.length) parts.push(text.substring(lastIndex));
        return parts;
    };

    const entry = entries[currentIndex];
    const entryAnnots = annotations[currentIndex] || {};

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', boxSizing: 'border-box', overflow: 'hidden' }}>
            <div style={{ padding: '10px', borderBottom: '1px solid #ccc', background: '#f0f0f0', flexShrink: 0 }}>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px' }}>
                    <button onClick={handleOpenFolder} style={{ padding: '5px 10px', cursor: 'pointer' }}>
                        {dirHandle ? 'Switch Folder' : 'Open Folder'}
                    </button>
                    {dirHandle && <span style={{ fontSize: '0.9em', color: '#555' }}>Folder Access Granted</span>}
                </div>
                
                {dirHandle && fileList.length === 0 && (
                    <div style={{ color: '#888' }}>No .jsonl files found in this folder.</div>
                )}

                {/* File List Dropdown or List */}
                {dirHandle && fileList.length > 0 && (
                    <div style={{ marginBottom: '10px' }}>
                        <select 
                            style={{ width: '100%', padding: '5px' }} 
                            onChange={(e) => {
                                const file = fileList.find(f => f.name === e.target.value);
                                if(file) handleSelectFile(file);
                            }}
                            value={currentFileHandle ? currentFileHandle.name : ""}
                        >
                            <option value="" disabled>-- Select a File --</option>
                            {fileList.map(f => (
                                <option key={f.name} value={f.name}>
                                    {f.name}
                                </option>
                            ))}
                        </select>
                    </div>
                )}

                {entries.length > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                         <div>
                            <strong>{currentIndex + 1}</strong> / {entries.length}
                            {saveStatus && <span style={{ marginLeft: '10px', fontSize: '0.8em', color: saveStatus === 'error' ? 'red' : 'green' }}>{saveStatus}</span>}
                        </div>
                        <div className="btn-group">
                            <button disabled={currentIndex === 0} onClick={prevEntry}>Prev</button>
                            <button disabled={currentIndex === entries.length - 1} onClick={nextEntry}>Next</button>
                        </div>
                    </div>
                )}
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
                {!entry && <div style={{ color: '#888', marginTop: '20px', textAlign: 'center' }}>
                    {loading ? 'Loading...' : 'Select a folder and file to begin'}
                </div>}

                {entry && (
                    <div>
                        <h3 style={{ margin: '0 0 10px 0' }}>{entry.mutation_id || 'Entry'}</h3>
                        {Object.keys(entry).map(key => {
                            if (TELEMETRY_KEYS.includes(key)) return null;
                            const val = entry[key];
                            const currentAnnot = entryAnnots[key] || { correctness: 'unchecked', comment: '' };
                            const isYes = currentAnnot.correctness === 'yes';
                            const isNo = currentAnnot.correctness === 'no';
                            const isUnchecked = currentAnnot.correctness === 'unchecked';

                            return (
                                <div key={key} style={{ background: 'white', padding: '10px', marginBottom: '15px', borderRadius: '5px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                                    <div style={{ fontWeight: 'bold', fontSize: '0.9em', color: '#555', marginBottom: '5px', textTransform: 'capitalize' }}>
                                        {key.replace(/_/g, ' ')}
                                    </div>
                                    <div style={{ whiteSpace: 'pre-wrap', fontSize: '13px', fontFamily: 'sans-serif', lineHeight: '1.4', marginBottom: '8px', padding: '5px', background: '#f9f9f9' }}>
                                        {renderContent(val)}
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', borderTop: '1px solid #eee', paddingTop: '8px' }}>
                                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                            <label style={{ display: 'flex', alignItems: 'center', fontSize: '12px', cursor: 'pointer', color: isYes ? '#2e7d32' : 'inherit' }}>
                                                <input type="radio" name={`correct-${currentIndex}-${key}`} checked={isYes} onChange={() => handleAnnotationChange(key, 'correctness', 'yes')} /> Correct
                                            </label>
                                            <label style={{ display: 'flex', alignItems: 'center', fontSize: '12px', cursor: 'pointer', color: isNo ? '#c62828' : 'inherit' }}>
                                                <input type="radio" name={`correct-${currentIndex}-${key}`} checked={isNo} onChange={() => handleAnnotationChange(key, 'correctness', 'no')} /> Incorrect
                                            </label>
                                             <label style={{ display: 'flex', alignItems: 'center', fontSize: '12px', cursor: 'pointer', color: isUnchecked ? '#666' : 'inherit' }}>
                                                <input type="radio" name={`correct-${currentIndex}-${key}`} checked={isUnchecked} onChange={() => handleAnnotationChange(key, 'correctness', 'unchecked')} /> Unchecked
                                            </label>
                                        </div>
                                        <textarea placeholder="Comment..." value={currentAnnot.comment || ''} onChange={(e) => handleAnnotationChange(key, 'comment', e.target.value)} style={{ width: '100%', fontSize: '12px', padding: '4px', resize: 'vertical', minHeight: '30px', boxSizing: 'border-box' }} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default JsonlViewer;
