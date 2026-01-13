"use client";

import React from "react";
import "./glass-buttons.css";

export default function GlassDemoPage() {
    return (
        <div className="glass-demo-container">
            {/* Background gradient */}
            <div className="glass-bg"></div>

            <div className="demo-content">
                <h1 className="demo-title">Glassmorphism Buttons</h1>
                <p className="demo-subtitle">Inspired by Source BTN V.02</p>

                {/* Button Showcase */}
                <div className="button-showcase">

                    {/* Section 1: Circle Buttons */}
                    <section className="button-section">
                        <h2 className="section-title">Circle Icons</h2>
                        <div className="button-group">
                            <button className="glass-btn glass-btn-circle" aria-label="Upload">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 19V5M5 12l7-7 7 7" />
                                </svg>
                            </button>

                            <button className="glass-btn glass-btn-circle" aria-label="Download">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 5v14M5 12l7 7 7-7" />
                                </svg>
                            </button>

                            <button className="glass-btn glass-btn-circle" aria-label="Add">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 5v14M5 12h14" />
                                </svg>
                            </button>

                            <button className="glass-btn glass-btn-circle" aria-label="Settings">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <circle cx="12" cy="12" r="3" />
                                    <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
                                </svg>
                            </button>
                        </div>
                    </section>

                    {/* Section 2: Pill Buttons */}
                    <section className="button-section">
                        <h2 className="section-title">Pill Buttons</h2>
                        <div className="button-group">
                            <button className="glass-btn glass-btn-pill">
                                Upload
                            </button>

                            <button className="glass-btn glass-btn-pill">
                                Download
                            </button>

                            <button className="glass-btn glass-btn-pill glass-btn-pill-lg">
                                Get Started
                            </button>
                        </div>
                    </section>

                    {/* Section 3: Icon + Text Buttons */}
                    <section className="button-section">
                        <h2 className="section-title">Icon + Text</h2>
                        <div className="button-group">
                            <button className="glass-btn glass-btn-icon-text">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 19V5M5 12l7-7 7 7" />
                                </svg>
                                <span>Upload File</span>
                            </button>

                            <button className="glass-btn glass-btn-icon-text">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                                    <polyline points="17,21 17,13 7,13 7,21" />
                                    <polyline points="7,3 7,8 15,8" />
                                </svg>
                                <span>Save Changes</span>
                            </button>
                        </div>
                    </section>

                    {/* Section 4: Neumorphic Style */}
                    <section className="button-section">
                        <h2 className="section-title">Neumorphic Buttons</h2>
                        <div className="button-group">
                            <button className="neu-btn neu-btn-circle" aria-label="Play">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                                    <polygon points="5,3 19,12 5,21" />
                                </svg>
                            </button>

                            <button className="neu-btn neu-btn-pill">
                                Submit
                            </button>

                            <button className="neu-btn neu-btn-pill neu-btn-active">
                                Active State
                            </button>
                        </div>
                    </section>

                    {/* Section 5: Combined Glass Card */}
                    <section className="button-section full-width">
                        <h2 className="section-title">Glass Card with Buttons</h2>
                        <div className="glass-card">
                            <div className="glass-card-header">
                                <h3>Upload Files</h3>
                                <p>Drag and drop or click to upload</p>
                            </div>
                            <div className="glass-card-actions">
                                <button className="glass-btn glass-btn-circle">
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M12 19V5M5 12l7-7 7 7" />
                                    </svg>
                                </button>
                                <button className="glass-btn glass-btn-pill glass-btn-pill-lg">
                                    Upload Now
                                </button>
                            </div>
                        </div>
                    </section>

                </div>

                {/* CSS Code Preview */}
                <section className="code-section">
                    <h2 className="section-title">Copy CSS</h2>
                    <div className="glass-card code-card">
                        <pre className="code-block">
                            {`.glass-btn {
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.25);
  box-shadow: 
    0 8px 32px rgba(0, 0, 0, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.4),
    inset 0 -1px 0 rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.9);
  cursor: pointer;
  transition: all 0.3s ease;
}

.glass-btn:hover {
  background: rgba(255, 255, 255, 0.25);
  transform: translateY(-2px);
  box-shadow: 
    0 12px 40px rgba(0, 0, 0, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.5);
}`}
                        </pre>
                    </div>
                </section>

            </div>
        </div>
    );
}
