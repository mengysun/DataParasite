import React, { useState, useEffect, useRef } from 'react';

const JsonlViewer = () => {
    const [entries, setEntries] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [filename, setFilename] = useState("");
    const [annotations, setAnnotations] = useState({}); // Map index -> annotation object

    // Telemetry fields to hide/minimize
    const TELEMETRY_KEYS = [
        'input_mutation_id', 'timestamp', 'model', 'response_id',
        'input_tokens', 'output_tokens', 'cached_tokens',
        'web_search_calls', 'total_cost', 'duration_seconds', 'status', 'user_annotations'
    ];

    const handleFileUpload = (event) => {
        const file = event.target.files[0];
        if (file) {
            setFilename(file.name);
            const reader = new FileReader();
            reader.onload = (e) => {
                const text = e.target.result;
                const lines = text.split('\n');
                const parsedEntries = [];
                const loadedAnnotations = {};

                lines.forEach((line, idx) => {
                    if (line.trim()) {
                        try {
                            const obj = JSON.parse(line);
                            // Check if already has annotations
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
                setCurrentIndex(0);
            };
            reader.readAsText(file);
        }
    };

    const handleUrlClick = (url) => {
        // Use Chrome API to update the main tab or create new one
        if (chrome && chrome.tabs) {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                // If we are in a side panel, we want to update the 'active' tab in this window
                // Or find a tab to reuse? simpler to just update the active one.
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

    const handleAnnotationChange = (key, field, value) => {
        setAnnotations(prev => {
            const currentEntryAnnots = prev[currentIndex] || {};
            const fieldAnnot = currentEntryAnnots[key] || { correctness: 'unchecked', comment: '' };

            return {
                ...prev,
                [currentIndex]: {
                    ...currentEntryAnnots,
                    [key]: { ...fieldAnnot, [field]: value }
                }
            };
        });
    };

    const handleDownload = () => {
        // Merge entries with annotations
        const outputLines = entries.map((entry, idx) => {
            const entryAnnot = annotations[idx];
            const newEntry = { ...entry };
            if (entryAnnot) {
                newEntry.user_annotations = entryAnnot;
            }
            return JSON.stringify(newEntry);
        }).join('\n');

        const blob = new Blob([outputLines], { type: 'application/x-jsonl' });
        const url = URL.createObjectURL(blob);
        const outName = filename ? filename.replace('.jsonl', '_annotated.jsonl') : 'annotated.jsonl';

        if (chrome && chrome.downloads) {
            chrome.downloads.download({
                url: url,
                filename: outName,
                saveAs: true
            });
        } else {
            const link = document.createElement('a');
            link.href = url;
            link.download = outName;
            link.click();
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

        // Match [text](url) or http links
        const parts = [];
        let lastIndex = 0;
        const regex = /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)|(https?:\/\/[^\s]+)/g;
        let match;

        while ((match = regex.exec(text)) !== null) {
            // Text before match
            if (match.index > lastIndex) {
                parts.push(text.substring(lastIndex, match.index));
            }

            const url = match[2] || match[3];
            const label = match[1] || url; // If markdown, use label, else url

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

        if (lastIndex < text.length) {
            parts.push(text.substring(lastIndex));
        }

        return parts;
    };

    // Current Entry Data
    const entry = entries[currentIndex];
    const entryAnnots = annotations[currentIndex] || {};

    return (
        <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', height: '100vh', boxSizing: 'border-box' }}>
            {/* Header / Controls */}
            <div style={{ paddingBottom: '10px', borderBottom: '1px solid #ccc', marginBottom: '10px' }}>
                <div style={{ marginBottom: '10px' }}>
                    <input type="file" accept=".jsonl" onChange={handleFileUpload} />
                </div>
                {entries.length > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                            <strong>{currentIndex + 1}</strong> / {entries.length}
                        </div>
                        <div className="btn-group">
                            <button disabled={currentIndex === 0} onClick={prevEntry}>Prev</button>
                            <button disabled={currentIndex === entries.length - 1} onClick={nextEntry}>Next</button>
                        </div>
                        <button onClick={handleDownload} style={{ background: '#4CAF50', color: 'white' }}>Save</button>
                    </div>
                )}
            </div>

            {/* Main Content Area - Scrollable */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
                {!entry && <div style={{ color: '#888', marginTop: '20px', textAlign: 'center' }}>Load a JSONL file to begin</div>}

                {entry && (
                    <div>
                        <h3 style={{ margin: '0 0 10px 0' }}>{entry.mutation_id || 'Entry'}</h3>

                        {/* Render Fields */}
                        {Object.keys(entry).map(key => {
                            if (TELEMETRY_KEYS.includes(key)) return null;

                            const val = entry[key];
                            const currentAnnot = entryAnnots[key] || { correctness: 'unchecked', comment: '' };
                            const isYes = currentAnnot.correctness === 'yes';
                            const isNo = currentAnnot.correctness === 'no';

                            return (
                                <div key={key} style={{ background: 'white', padding: '10px', marginBottom: '15px', borderRadius: '5px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                                    <div style={{ fontWeight: 'bold', fontSize: '0.9em', color: '#555', marginBottom: '5px', textTransform: 'capitalize' }}>
                                        {key.replace(/_/g, ' ')}
                                    </div>
                                    <div style={{ whiteSpace: 'pre-wrap', fontSize: '13px', fontFamily: 'sans-serif', lineHeight: '1.4', marginBottom: '8px', padding: '5px', background: '#f9f9f9' }}>
                                        {renderContent(val)}
                                    </div>

                                    {/* Annotation Controls */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', borderTop: '1px solid #eee', paddingTop: '8px' }}>
                                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                            <label style={{ display: 'flex', alignItems: 'center', fontSize: '12px', cursor: 'pointer', color: isYes ? '#2e7d32' : 'inherit' }}>
                                                <input
                                                    type="radio"
                                                    name={`correct-${currentIndex}-${key}`}
                                                    checked={isYes}
                                                    onChange={() => handleAnnotationChange(key, 'correctness', 'yes')}
                                                />
                                                Correct
                                            </label>
                                            <label style={{ display: 'flex', alignItems: 'center', fontSize: '12px', cursor: 'pointer', color: isNo ? '#c62828' : 'inherit' }}>
                                                <input
                                                    type="radio"
                                                    name={`correct-${currentIndex}-${key}`}
                                                    checked={isNo}
                                                    onChange={() => handleAnnotationChange(key, 'correctness', 'no')}
                                                />
                                                Incorrect
                                            </label>
                                        </div>
                                        <textarea
                                            placeholder="Comment..."
                                            value={currentAnnot.comment || ''}
                                            onChange={(e) => handleAnnotationChange(key, 'comment', e.target.value)}
                                            style={{ width: '100%', fontSize: '12px', padding: '4px', resize: 'vertical', minHeight: '30px', boxSizing: 'border-box' }}
                                        />
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
