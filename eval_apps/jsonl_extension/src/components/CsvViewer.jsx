import React, { useState, useEffect } from 'react';
import Papa from 'papaparse';

const CsvViewer = () => {
    const [data, setData] = useState([]);
    const [headers, setHeaders] = useState([]);
    const [selectedCell, setSelectedCell] = useState(null); // { row: number, col: string }
    const [isEditing, setIsEditing] = useState(false);
    const cellRefs = React.useRef({});

    const handleFileUpload = (event) => {
        const file = event.target.files[0];
        if (file) {
            Papa.parse(file, {
                header: true,
                skipEmptyLines: true,
                complete: (results) => {
                    setHeaders(results.meta.fields);
                    setData(results.data);
                    setSelectedCell(null);
                    setIsEditing(false);
                },
            });
        }
    };

    const handleUrlClick = (url) => {
        if (chrome.tabs) {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                chrome.tabs.update(tabs[0].id, { url: url });
            });
        } else {
            window.open(url, '_blank');
        }
    };

    const handleAddColumn = () => {
        const newColumnName = prompt("Enter new column name:");
        if (newColumnName && !headers.includes(newColumnName)) {
            setHeaders([...headers, newColumnName]);
            setData(data.map(row => ({ ...row, [newColumnName]: '' })));
        }
    };

    const handleCellChange = (rowIndex, header, value) => {
        const newData = [...data];
        newData[rowIndex][header] = value;
        setData(newData);
    };

    const handleSave = () => {
        let dataToSave = data;

        // Capture pending edits if currently editing
        if (isEditing && selectedCell) {
            const key = `${selectedCell.row}-${selectedCell.col}`;
            const el = cellRefs.current[key];
            if (el) {
                const currentValue = el.innerText;
                const newData = [...data];
                newData[selectedCell.row][selectedCell.col] = currentValue;
                dataToSave = newData;
                setData(newData); // Sync state as well
            }
        }

        const csv = Papa.unparse(dataToSave, {
            columns: headers
        });
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);

        // Use chrome.downloads API if available to force "Save As"
        if (chrome && chrome.downloads && chrome.downloads.download) {
            chrome.downloads.download({
                url: url,
                filename: 'curated_data.csv',
                saveAs: true // This forces the Save As dialog
            }, (downloadId) => {
                if (chrome.runtime.lastError) {
                    console.error("Download failed:", chrome.runtime.lastError);
                    // Fallback to link click if API fails for some reason?
                    // Usually if API exists but fails it might be permissions or user cancellation.
                    // Let's just log it for now.
                }
            });
        } else {
            // Fallback for local dev or if API not available
            const link = document.createElement('a');
            link.setAttribute('href', url);
            link.setAttribute('download', 'curated_data.csv');
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };

    const [contextMenu, setContextMenu] = useState(null);

    const handleContextMenu = (e, header, index) => {
        e.preventDefault();
        setContextMenu({
            mouseX: e.clientX,
            mouseY: e.clientY,
            header,
            index,
        });
    };

    const handleCloseContextMenu = () => {
        setContextMenu(null);
    };

    const handleInsertColumn = (direction) => {
        if (!contextMenu) return;

        const newColumnName = prompt("Enter new column name:");
        if (!newColumnName || headers.includes(newColumnName)) {
            handleCloseContextMenu();
            return;
        }

        const { index } = contextMenu;
        const insertIndex = direction === 'left' ? index : index + 1;

        const newHeaders = [...headers];
        newHeaders.splice(insertIndex, 0, newColumnName);
        setHeaders(newHeaders);

        const newData = data.map(row => {
            const newRow = { ...row, [newColumnName]: '' };
            return newRow;
        });
        setData(newData);
        handleCloseContextMenu();
    };

    const handleDeleteColumn = () => {
        if (!contextMenu) return;
        if (confirm(`Are you sure you want to delete column "${contextMenu.header}"?`)) {
            const newHeaders = headers.filter(h => h !== contextMenu.header);
            setHeaders(newHeaders);
        }
        handleCloseContextMenu();
    };

    // Close context menu on click outside
    useEffect(() => {
        const handleClick = () => handleCloseContextMenu();
        document.addEventListener('click', handleClick);
        return () => {
            document.removeEventListener('click', handleClick);
        };
    }, []);

    const [columnWidths, setColumnWidths] = useState({});
    const [rowHeights, setRowHeights] = useState({});
    const resizingRef = React.useRef(null);

    // Initialize widths when headers change
    useEffect(() => {
        const initialWidths = {};
        headers.forEach(h => {
            if (!columnWidths[h]) {
                initialWidths[h] = 150; // Default width
            }
        });
        setColumnWidths(prev => ({ ...prev, ...initialWidths }));
    }, [headers]);

    const handleMouseMove = React.useCallback((e) => {
        if (resizingRef.current) {
            const { type, id, start, startSize } = resizingRef.current;

            if (type === 'col') {
                const diff = e.clientX - start;
                const newWidth = Math.max(50, startSize + diff);
                setColumnWidths(prev => ({
                    ...prev,
                    [id]: newWidth,
                }));
            } else if (type === 'row') {
                const diff = e.clientY - start;
                const newHeight = Math.max(30, startSize + diff);
                setRowHeights(prev => ({
                    ...prev,
                    [id]: newHeight,
                }));
            }
        }
    }, []);

    const handleMouseUp = React.useCallback(() => {
        if (resizingRef.current) {
            resizingRef.current = null;
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = '';
        }
    }, [handleMouseMove]);

    const handleMouseDown = (e, type, id) => {
        // type: 'col' | 'row'
        // id: header (string) | rowIndex (number)
        e.preventDefault();
        e.stopPropagation();

        const startSize = type === 'col' ? (columnWidths[id] || 150) : (rowHeights[id] || 'auto');
        // If row height is auto, we need to get computed height, but for simplicity let's default to a reasonable px if not set
        // Actually, if it's auto, we might jump. Let's try to get it from event target parent if needed, but state is safer.
        // For now, default row height 30px if not set.
        const effectiveStartSize = startSize === 'auto' ? 30 : startSize;

        resizingRef.current = {
            type,
            id,
            start: type === 'col' ? e.clientX : e.clientY,
            startSize: effectiveStartSize,
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = type === 'col' ? 'col-resize' : 'row-resize';
    };

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [handleMouseMove, handleMouseUp]);

    // Keyboard Navigation Logic
    const handleCellClick = (rowIndex, header) => {
        setSelectedCell({ row: rowIndex, col: header });
        setIsEditing(false);
    };

    const handleCellDoubleClick = (rowIndex, header) => {
        setSelectedCell({ row: rowIndex, col: header });
        setIsEditing(true);
    };

    const handleKeyDown = (e, rowIndex, header) => {
        if (isEditing) {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleCellChange(rowIndex, header, e.target.innerText);
                setIsEditing(false);
                // Optional: Move down on enter
                const nextRow = Math.min(data.length - 1, rowIndex + 1);
                setSelectedCell({ row: nextRow, col: header });
            } else if (e.key === 'Escape') {
                e.preventDefault();
                setIsEditing(false);
                // Revert change logic could go here if we stored previous value
                if (cellRefs.current[`${rowIndex}-${header}`]) {
                    cellRefs.current[`${rowIndex}-${header}`].focus();
                }
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                // Allow default behavior or commit and move?
                // Standard spreadsheet behavior: commit and move
                e.preventDefault();
                handleCellChange(rowIndex, header, e.target.innerText);
                setIsEditing(false);
                const direction = e.key === 'ArrowUp' ? -1 : 1;
                const nextRow = Math.max(0, Math.min(data.length - 1, rowIndex + direction));
                setSelectedCell({ row: nextRow, col: header });
            }
            return;
        }

        // Navigation Mode
        let nextRow = rowIndex;
        let nextColIdx = headers.indexOf(header);

        if (e.key === 'ArrowUp') {
            e.preventDefault();
            nextRow = Math.max(0, rowIndex - 1);
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            nextRow = Math.min(data.length - 1, rowIndex + 1);
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            nextColIdx = Math.max(0, nextColIdx - 1);
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            nextColIdx = Math.min(headers.length - 1, nextColIdx + 1);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            setIsEditing(true);
            return;
        } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            // If user types a character, start editing and replace content?
            // For now, let's just enter edit mode on Enter or Double Click.
            // Or we could auto-enter edit mode.
            // Let's stick to Enter/Double Click for safety first.
        }

        const nextHeader = headers[nextColIdx];
        setSelectedCell({ row: nextRow, col: nextHeader });
    };

    // Focus management
    useEffect(() => {
        if (selectedCell) {
            const key = `${selectedCell.row}-${selectedCell.col}`;
            const el = cellRefs.current[key];
            if (el) {
                // Always focus the element if selected
                el.focus();

                // If editing, ensure caret is at the end
                if (isEditing) {
                    const range = document.createRange();
                    const sel = window.getSelection();
                    // Select all content then collapse to end
                    range.selectNodeContents(el);
                    range.collapse(false);
                    sel.removeAllRanges();
                    sel.addRange(range);
                }
            }
        }
    }, [selectedCell, isEditing]);


    return (
        <div className="csv-viewer">
            <div className="controls">
                <input type="file" accept=".csv" onChange={handleFileUpload} />
                <button onClick={handleAddColumn} disabled={data.length === 0}>Add Column (End)</button>
                <button onClick={handleSave} disabled={data.length === 0}>Save CSV</button>
            </div>
            {data.length > 0 && (
                <table>
                    <thead>
                        <tr>
                            <th className="row-number-cell">#</th>
                            {headers.map((header, index) => (
                                <th
                                    key={header}
                                    onContextMenu={(e) => handleContextMenu(e, header, index)}
                                    style={{
                                        cursor: 'context-menu',
                                        width: columnWidths[header] || 150,
                                        // position: 'sticky' is in CSS, which creates a context for absolute children too.
                                    }}
                                >
                                    {header}
                                    <div
                                        className="resize-handle-col"
                                        onMouseDown={(e) => handleMouseDown(e, 'col', header)}
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {data.map((row, rowIndex) => {
                            const isRowSelected = selectedCell?.row === rowIndex;
                            return (
                                <tr key={rowIndex} style={{ height: isRowSelected ? 'auto' : (rowHeights[rowIndex] || 'auto') }}>
                                    <td className="row-number-cell" style={{ padding: '8px' }}>
                                        {rowIndex + 1}
                                    </td>
                                    {headers.map((header) => {
                                        const isSelected = selectedCell?.row === rowIndex && selectedCell?.col === header;
                                        const isCellEditing = isSelected && isEditing;

                                        return (
                                            <td
                                                key={`${rowIndex}-${header}`}
                                                style={{ padding: 0 }}
                                            >
                                                <div
                                                    className={`cell-content ${isSelected ? 'selected-cell' : ''}`}
                                                    ref={el => cellRefs.current[`${rowIndex}-${header}`] = el}
                                                    tabIndex={0}
                                                    contentEditable={isCellEditing}
                                                    suppressContentEditableWarning
                                                    onBlur={(e) => {
                                                        if (isCellEditing) {
                                                            handleCellChange(rowIndex, header, e.target.innerText);
                                                        }
                                                    }}
                                                    onClick={() => handleCellClick(rowIndex, header)}
                                                    onDoubleClick={() => handleCellDoubleClick(rowIndex, header)}
                                                    onKeyDown={(e) => handleKeyDown(e, rowIndex, header)}
                                                >
                                                    {row[header] && row[header].toString().startsWith('http') && !isCellEditing ? (
                                                        <span
                                                            style={{ color: 'blue', textDecoration: 'underline', cursor: 'pointer' }}
                                                            contentEditable={false}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleUrlClick(row[header]);
                                                            }}
                                                        >
                                                            {row[header]}
                                                            <span style={{ fontSize: '0.8em', marginLeft: '5px' }}>🔗</span>
                                                        </span>
                                                    ) : (
                                                        row[header]
                                                    )}
                                                </div>
                                                {/* Resize Handles for every cell */}
                                                <div
                                                    className="resize-handle-col"
                                                    contentEditable={false}
                                                    onMouseDown={(e) => handleMouseDown(e, 'col', header)}
                                                    onClick={(e) => e.stopPropagation()}
                                                />
                                                <div
                                                    className="resize-handle-row"
                                                    contentEditable={false}
                                                    onMouseDown={(e) => handleMouseDown(e, 'row', rowIndex)}
                                                    onClick={(e) => e.stopPropagation()}
                                                />
                                            </td>
                                        )
                                    })}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            )}
            {contextMenu && (
                <div
                    className="context-menu"
                    style={{
                        top: contextMenu.mouseY,
                        left: contextMenu.mouseX,
                    }}
                >
                    <div onClick={() => handleInsertColumn('left')}>Insert Left</div>
                    <div onClick={() => handleInsertColumn('right')}>Insert Right</div>
                    <div onClick={handleDeleteColumn} style={{ color: 'red' }}>Delete Column</div>
                </div>
            )}
        </div>
    );
};

export default CsvViewer;
