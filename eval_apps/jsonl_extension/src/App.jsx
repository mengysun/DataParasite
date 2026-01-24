import React from 'react'
import './App.css'
import JsonlViewer from './components/JsonlViewer'

function App() {
  return (
    <div className="App">
      <h2 style={{ textAlign: 'center', margin: '10px 0' }}>Evaluator</h2>
      <JsonlViewer />
    </div>
  )
}

export default App
