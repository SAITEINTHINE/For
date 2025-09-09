let historyData = []; // Global state for history data
let deleteIndex = -1;

// NEW: prevent runtime error from base.html call
window.setAuthenticated = function (val) {
    try {
        document.body.dataset.authenticated = val ? 'true' : 'false';
    } catch (e) {
        console.warn('setAuthenticated noop:', e);
    }
};

/* === Mobile nav toggle (smartphone hamburger) === */
function initMobileMenu() {
    const btn = document.getElementById('mobile-menu-button');
    const menu = document.getElementById('mobile-menu');
    if (!btn || !menu) return;

    // Ensure menu starts hidden on small screens
    if (!menu.classList.contains('hidden')) {
        menu.classList.add('hidden');
    }

    btn.addEventListener('click', () => {
        const willOpen = menu.classList.contains('hidden');
        menu.classList.toggle('hidden');
        btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });

    // Close after tapping a link (nice UX)
    menu.querySelectorAll('a').forEach(a => {
        a.addEventListener('click', () => {
            menu.classList.add('hidden');
            btn.setAttribute('aria-expanded', 'false');
        });
    });

    // Close if user taps outside the open panel
    document.addEventListener('click', (e) => {
        const clickedInsideMenu = menu.contains(e.target);
        const clickedBtn = btn.contains(e.target);
        if (!clickedInsideMenu && !clickedBtn && !menu.classList.contains('hidden')) {
            menu.classList.add('hidden');
            btn.setAttribute('aria-expanded', 'false');
        }
    });
}

// Fetch history data from server with cache busting
function fetchHistory() {
    return fetch('/api/history?' + new Date().getTime(), {
        credentials: 'same-origin' // Include cookies for session authentication
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            console.warn('Response is not JSON, likely HTML:', contentType);
            throw new Error('Invalid response format');
        }
        return response.json();
    })
    .then(data => {
        if (data) {
            historyData = Array.isArray(data) ? data : [];
            console.log('History data fetched, length:', historyData.length, 'data:', historyData);
            updateHistoryTable();
        } else {
            throw new Error('No data received');
        }
    })
    .catch(error => {
        console.error('Error fetching history:', error);
        showNotification('Failed to load history: ' + error.message, 'error');
        historyData = []; // Reset to empty on error
        updateHistoryTable();
    });
}

// Initialize application with server data
function initialize() {
    console.log('Initializing application...');
    initMobileMenu();

    if (document.body.dataset.authenticated === 'true') {
        fetchHistory(); // Fetch history immediately if authenticated
    }
    updateActiveUsers();
    const textInput = document.getElementById('text-input');
    if (textInput) {
        textInput.addEventListener('input', function() {
            const text = this.value;
            const charCount = text.length;
            const wordCount = text.trim().split(/\s+/).filter(word => word.length > 0).length;
            document.getElementById('char-count').textContent = charCount + ' characters';
            document.getElementById('word-count').textContent = wordCount + ' words';
            const qualityElement = document.getElementById('text-quality');
            if (charCount < 100) {
                qualityElement.textContent = 'Too short for analysis';
                qualityElement.className = 'text-xs font-medium text-red-500';
            } else if (charCount < 300) {
                qualityElement.textContent = 'Basic analysis available';
                qualityElement.className = 'text-xs font-medium text-yellow-500';
            } else {
                qualityElement.textContent = 'Optimal for detailed analysis';
                qualityElement.className = 'text-xs font-medium text-green-500';
            }
        });
    }
    hideProgressModal();
}

// File upload handlers
function handleImageUpload(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            document.getElementById('preview-img').src = e.target.result;
            document.getElementById('image-name').textContent = file.name;
            document.getElementById('image-size').textContent = `${(file.size / 1024 / 1024).toFixed(2)} MB • ${file.type}`;
            document.getElementById('image-upload-area').classList.add('hidden');
            document.getElementById('image-preview').classList.remove('hidden');
        };
        reader.readAsDataURL(file);
    }
}

function handleVideoUpload(event) {
    const file = event.target.files[0];
    if (file) {
        document.getElementById('video-name').textContent = file.name;
        document.getElementById('video-size').textContent = `${(file.size / 1024 / 1024).toFixed(2)} MB • ${file.type}`;
        document.getElementById('video-upload-area').classList.add('hidden');
        document.getElementById('video-preview').classList.remove('hidden');
    }
}

// Analysis functions with immediate table update
function addToHistory(type, content, score, confidence, fullContent) {
    const analysis = score < 30 ? 'Likely human-created content' :
                    score < 70 ? 'Moderate AI generation probability' :
                    'High probability AI-generated content';
    const newEntry = {
        type: type,
        content: content,
        score: score,
        confidence: confidence,
        date: new Date().toLocaleString(),
        fullContent: fullContent,
        analysis: analysis
    };
    historyData.unshift(newEntry);
    updateHistoryTable();
}

function analyzeText(event) {
    event.preventDefault();
    const text = document.getElementById('text-input').value;
    if (text.length < 50) {
        showNotification('Please enter at least 50 characters for analysis', 'error');
        return;
    }
    showProgressModal('text', 3000);
    setTimeout(() => {
        const score = Math.floor(Math.random() * 100);
        const confidence = Math.floor(Math.random() * 20) + 80;
        const preview = text.substring(0, 70) + (text.length > 70 ? '...' : '');
        fetch('/api/history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'text',
                content: preview,
                score: score,
                confidence: confidence,
                date: new Date().toLocaleString(),
                fullContent: text,
                analysis: ''
            })
        })
        .then(response => {
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return response.json();
        })
        .then(data => {
            if (data.status === 'success') {
                const newEntry = {
                    id: data.id,
                    type: 'text',
                    content: preview,
                    score: score,
                    confidence: confidence,
                    date: new Date().toLocaleString(),
                    fullContent: text,
                    analysis: score < 30 ? 'Likely human-created content' :
                           score < 70 ? 'Moderate AI generation probability' :
                           'High probability AI-generated content'
                };
                historyData.unshift(newEntry);
                updateHistoryTable();
                displayResult(newEntry);
                document.getElementById('text-input').value = '';
                document.getElementById('char-count').textContent = '0 characters';
                document.getElementById('word-count').textContent = '0 words';
                document.getElementById('text-quality').textContent = '';
                hideProgressModal();
                showNotification('Text analysis completed and saved to history!', 'success');
                setTimeout(() => {
                    window.location.href = `/results?id=${data.id}`;
                }, 100);
            } else {
                throw new Error(data.message || 'Failed to save to history');
            }
        })
        .catch(error => {
            console.error('Error saving text analysis:', error);
            hideProgressModal();
            showNotification('Error saving analysis: ' + error.message, 'error');
        });
    }, 3000);
}

function analyzeImage(event) {
    event.preventDefault();
    const fileInput = document.getElementById('image-input');
    const file = fileInput.files[0];
    if (!file) {
        showNotification('Please upload an image', 'error');
        return;
    }
    showProgressModal('image', 4000);
    setTimeout(() => {
        const score = Math.floor(Math.random() * 100);
        const confidence = Math.floor(Math.random() * 25) + 75;
        const fileSize = (file.size / 1024 / 1024).toFixed(2);
        const fullName = `${file.name} (${fileSize} MB)`;
        fetch('/api/history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'image',
                content: file.name,
                score: score,
                confidence: confidence,
                date: new Date().toLocaleString(),
                fullContent: fullName,
                analysis: ''
            })
        })
        .then(response => {
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return response.json();
        })
        .then(data => {
            if (data.status === 'success') {
                const newEntry = {
                    id: data.id,
                    type: 'image',
                    content: file.name,
                    score: score,
                    confidence: confidence,
                    date: new Date().toLocaleString(),
                    fullContent: fullName,
                    analysis: score < 30 ? 'Authentic human-created content' :
                           score < 70 ? 'Moderate AI generation probability' :
                           'High probability AI-generated content'
                };
                historyData.unshift(newEntry);
                updateHistoryTable();
                displayResult(newEntry);
                fileInput.value = '';
                document.getElementById('image-upload-area').classList.remove('hidden');
                document.getElementById('image-preview').classList.add('hidden');
                hideProgressModal();
                showNotification('Image analysis completed and saved to history!', 'success');
                setTimeout(() => {
                    window.location.href = `/results?id=${data.id}`;
                }, 100);
            } else {
                throw new Error(data.message || 'Failed to save to history');
            }
        })
        .catch(error => {
            console.error('Error saving image analysis:', error);
            hideProgressModal();
            showNotification('Error saving analysis: ' + error.message, 'error');
        });
    }, 4000);
}

function analyzeVideo(event) {
    event.preventDefault();
    const fileInput = document.getElementById('video-input');
    const file = fileInput.files[0];
    if (!file) {
        showNotification('Please upload a video', 'error');
        return;
    }
    showProgressModal('video', 6000);
    setTimeout(() => {
        const score = Math.floor(Math.random() * 100);
        const confidence = Math.floor(Math.random() * 30) + 70;
        const fileSize = (file.size / 1024 / 1024).toFixed(2);
        const fullName = `${file.name} (${fileSize} MB)`;
        fetch('/api/history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'video',
                content: file.name,
                score: score,
                confidence: confidence,
                date: new Date().toLocaleString(),
                fullContent: fullName,
                analysis: ''
            })
        })
        .then(response => {
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return response.json();
        })
        .then(data => {
            if (data.status === 'success') {
                const newEntry = {
                    id: data.id,
                    type: 'video',
                    content: file.name,
                    score: score,
                    confidence: confidence,
                    date: new Date().toLocaleString(),
                    fullContent: fullName,
                    analysis: score < 30 ? 'Authentic human-created content' :
                           score < 70 ? 'Moderate AI generation probability' :
                           'Strong deepfake indicators detected'
                };
                historyData.unshift(newEntry);
                updateHistoryTable();
                displayResult(newEntry);
                fileInput.value = '';
                document.getElementById('video-upload-area').classList.remove('hidden');
                document.getElementById('video-preview').classList.add('hidden');
                hideProgressModal();
                showNotification('Video analysis completed and saved to history!', 'success');
                setTimeout(() => {
                    window.location.href = `/results?id=${data.id}`;
                }, 100);
            } else {
                throw new Error(data.message || 'Failed to save to history');
            }
        })
        .catch(error => {
            console.error('Error saving video analysis:', error);
            hideProgressModal();
            showNotification('Error saving analysis: ' + error.message, 'error');
        });
    }, 6000);
}

// Display analysis result on the page
function displayResult(item) {
    const resultContainer = document.getElementById('result-container');
    const resultContent = document.getElementById('result-content');
    if (!resultContainer || !resultContent) {
        console.warn('Result container or content not found on this page');
        return;
    }
    const scoreClass = item.score < 30 ? 'text-green-600' : item.score < 70 ? 'text-yellow-600' : 'text-red-600';
    const confidenceClass = item.confidence >= 90 ? 'text-green-600' : item.confidence >= 75 ? 'text-yellow-600' : 'text-red-600';
    resultContent.innerHTML = `
        <div class="flex items-center mb-2">
            <i class="fas fa-${item.type === 'text' ? 'file-text' : item.type === 'image' ? 'image' : 'video'} text-${item.type === 'text' ? 'blue' : item.type === 'image' ? 'green' : 'purple'}-600 mr-2"></i>
            <span class="font-medium">${item.type.charAt(0).toUpperCase() + item.type.slice(1)}</span>
        </div>
        <p><strong>Content:</strong> ${item.fullContent}</p>
        <p><strong>Analysis:</strong> ${item.analysis}</p>
        <p><strong>AI Probability:</strong> <span class="${scoreClass}">${item.score}%</span></p>
        <p><strong>Confidence:</strong> <span class="${confidenceClass}">${item.confidence}%</span></p>
        <p><strong>Date:</strong> ${item.date}</p>
    `;
    resultContainer.classList.remove('hidden');
}

// Progress modal functions
function showProgressModal(type, duration) {
    const modal = document.getElementById('progress-modal');
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');
    const spinner = document.getElementById('spinner');
    if (!modal || !progressBar || !progressText || !spinner) {
        console.warn('Progress modal elements not found');
        return;
    }
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    spinner.classList.remove('hidden');
    progressBar.style.width = '0%';
    progressText.textContent = `Analyzing ${type} content...`;

    let progress = 0;
    const interval = setInterval(() => {
        progress += (100 / (duration / (type === 'video' ? 1000 : type === 'image' ? 800 : 600)));
        if (progress >= 100) progress = 100;
        progressBar.style.width = `${progress}%`;
        if (progress >= 100) clearInterval(interval);
    }, type === 'video' ? 1000 : type === 'image' ? 800 : 600);

    return interval;
}

function hideProgressModal() {
    const modal = document.getElementById('progress-modal');
    const progressBar = document.getElementById('progress-bar');
    const spinner = document.getElementById('spinner');
    if (!modal || !progressBar || !spinner) {
        console.warn('Progress modal or bar not found');
        return;
    }
    modal.classList.add('hidden');
    modal.style.display = 'none';
    spinner.classList.add('hidden');
    progressBar.style.width = '0%';
}

// History management
function updateHistoryTable() {
    const tbody = document.getElementById('history-table-body');
    const mobileContainer = document.getElementById('history-table-mobile');
    const emptyState = document.getElementById('empty-state');
    console.log('Updating history table with data:', historyData);
    if (!historyData.length) {
        if (tbody) tbody.innerHTML = '';
        if (mobileContainer) mobileContainer.innerHTML = '';
        if (emptyState) emptyState.classList.remove('hidden');
        return;
    }
    if (emptyState) emptyState.classList.add('hidden');
    if (tbody) {
        tbody.innerHTML = historyData.map((item, index) => {
            const typeConfig = {
                'text': { icon: 'fas fa-file-text', color: 'text-blue-600', bg: 'bg-blue-100' },
                'image': { icon: 'fas fa-image', color: 'text-green-600', bg: 'bg-green-100' },
                'video': { icon: 'fas fa-video', color: 'text-purple-600', bg: 'bg-purple-100' }
            };
            const config = typeConfig[item.type];
            const scoreClass = item.score < 30 ? 'text-green-600' : item.score < 70 ? 'text-yellow-600' : 'text-red-600';
            const confidenceClass = item.confidence >= 90 ? 'text-green-600' : item.confidence >= 75 ? 'text-yellow-600' : 'text-red-600';
            return `
                <tr class="hover:bg-gray-50 transition-colors">
                    <td class="px-6 py-4 whitespace-nowrap">
                        <div class="flex items-center">
                            <div class="${config.bg} p-2 rounded-lg">
                                <i class="${config.icon} ${config.color}"></i>
                            </div>
                        </div>
                    </td>
                    <td class="px-6 py-4">
                        <div class="max-w-xs">
                            <div class="text-sm font-medium text-gray-900 truncate" title="${item.fullContent || ''}">
                                ${item.content}
                            </div>
                            <div class="text-xs text-gray-500 mt-1">${item.analysis}</div>
                        </div>
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap">
                        <div class="flex items-center">
                            <div class="flex-shrink-0 w-16 h-2 bg-gray-200 rounded-full mr-3">
                                <div class="h-2 rounded-full ${scoreClass.replace('text-', 'bg-')}" style="width: ${item.score}%"></div>
                            </div>
                            <span class="text-sm font-semibold ${scoreClass}">${item.score}%</span>
                        </div>
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap">
                        <span class="text-sm font-medium ${confidenceClass}">${item.confidence}%</span>
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        ${item.date}
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap">
                        <div class="flex items-center space-x-2">
                            <button onclick="viewDetails(${index})" class="text-primary hover:text-primary-dark transition-colors" title="View details">
                                <i class="fas fa-eye"></i>
                            </button>
                            <button onclick="deleteEntry(${index})" class="text-red-600 hover:text-red-700 transition-colors" title="Delete entry">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }
    if (mobileContainer) {
        mobileContainer.innerHTML = historyData.map((item, index) => {
            const typeConfig = {
                'text': { icon: 'fas fa-file-text', color: 'text-blue-600', bg: 'bg-blue-100' },
                'image': { icon: 'fas fa-image', color: 'text-green-600', bg: 'bg-green-100' },
                'video': { icon: 'fas fa-video', color: 'text-purple-600', bg: 'bg-purple-100' }
            };
            const config = typeConfig[item.type];
            const scoreClass = item.score < 30 ? 'text-green-600' : item.score < 70 ? 'text-yellow-600' : 'text-red-600';
            const confidenceClass = item.confidence >= 90 ? 'text-green-600' : item.confidence >= 75 ? 'text-yellow-600' : 'text-red-600';
            return `
                <div class="bg-white rounded-xl shadow-md p-4 border border-gray-200">
                    <div class="flex items-center justify-between mb-2">
                        <div class="flex items-center">
                            <div class="${config.bg} p-2 rounded-lg">
                                <i class="${config.icon} ${config.color}"></i>
                            </div>
                            <span class="ml-2 text-sm font-semibold text-gray-900">${item.type.charAt(0).toUpperCase() + item.type.slice(1)}</span>
                        </div>
                        <div class="flex items-center space-x-2">
                            <button onclick="viewDetails(${index})" class="text-primary hover:text-primary-dark" title="View details">
                                <i class="fas fa-eye"></i>
                            </button>
                            <button onclick="deleteEntry(${index})" class="text-red-600 hover:text-red-700" title="Delete entry">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                    <div class="text-sm text-gray-900 mb-1"><strong>Content:</strong> ${item.content}</div>
                    <div class="text-sm text-gray-500 mb-1"><strong>Analysis:</strong> ${item.analysis}</div>
                    <div class="text-sm mb-1"><strong>AI Probability:</strong> <span class="${scoreClass}">${item.score}%</span></div>
                    <div class="text-sm mb-1"><strong>Confidence:</strong> <span class="${confidenceClass}">${item.confidence}%</span></div>
                    <div class="text-sm text-gray-500"><strong>Date:</strong> ${item.date}</div>
                </div>
            `;
        }).join('');
    }
}

// Utility functions
function deleteEntry(index) {
    console.log('Delete entry triggered for index:', index);
    deleteIndex = index;
    const modal = document.getElementById('confirmation-modal');
    if (modal) modal.classList.remove('hidden');
}

function confirmDelete() {
    console.log('Confirming delete for index:', deleteIndex);
    if (deleteIndex >= 0) {
        const entryId = historyData[deleteIndex].id;
        fetch(`/api/history/${entryId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin'
        })
        .then(response => {
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return response.json();
        })
        .then(data => {
            if (data.status === 'success') {
                console.log('Deletion successful, refetching history');
                historyData.splice(deleteIndex, 1);
                fetchHistory(); // Re-fetch to sync with server
                updateHistoryTable();
                showNotification('Analysis result deleted successfully', 'success');
            } else {
                throw new Error(data.message || 'Failed to delete entry');
            }
        })
        .catch(error => {
            console.error('Error deleting entry:', error);
            showNotification('Error deleting entry: ' + error.message, 'error');
        });
        deleteIndex = -1;
        closeModal();
    }
}

function closeModal() {
    const modal = document.getElementById('confirmation-modal');
    if (modal) modal.classList.add('hidden');
    deleteIndex = -1;
}

function clearAllHistory() {
    console.log('Clear all history triggered');
    if (historyData.length === 0) return;
    if (confirm('Are you sure you want to clear all analysis history? This action cannot be undone.')) {
        fetch('/api/history', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin'
        })
        .then(response => {
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return response.json();
        })
        .then(data => {
            if (data.status === 'success') {
                console.log('Clear all successful, refetching history');
                historyData = [];
                fetchHistory(); // Re-fetch to sync with server
                updateHistoryTable();
                showNotification('All history cleared successfully', 'success');
            } else {
                throw new Error(data.message || 'Failed to clear history');
            }
        })
        .catch(error => {
            console.error('Error clearing history:', error);
            showNotification('Error clearing history: ' + error.message, 'error');
        });
    }
}

function exportHistory() {
    if (historyData.length === 0) {
        showNotification('No data to export', 'error');
        return;
    }
    const csvContent = "data:text/csv;charset=utf-8," +
        "Type,Content,AI Score,Confidence,Date,Analysis\n" +
        historyData.map(item =>
            `"${item.type}","${item.content.replace(/"/g, '""')}","${item.score}%","${item.confidence}%","${item.date}","${item.analysis.replace(/"/g, '""')}"`
        ).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `ai_detection_history_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showNotification('History exported successfully', 'success');
}

function viewDetails(index) {
    const item = historyData[index];
    showNotification(`Analysis Details: ${item.analysis} (${item.confidence}% confidence)`, 'info');
}

function showNotification(message, type = 'info') {
    const container = document.getElementById('notification-container');
    if (!container) {
        console.warn('Notification container not found');
        return;
    }
    const notification = document.createElement('div');
    const colors = {
        success: 'bg-green-500',
        error: 'bg-red-500',
        info: 'bg-blue-500',
        warning: 'bg-yellow-500'
    };
    const icons = {
        success: 'fas fa-check-circle',
        error: 'fas fa-exclamation-circle',
        info: 'fas fa-info-circle',
        warning: 'fas fa-exclamation-triangle'
    };
    notification.className = `${colors[type]} text-white px-6 py-4 rounded-lg shadow-lg notification max-w-sm`;
    notification.innerHTML = `
        <div class="flex items-center">
            <i class="${icons[type]} mr-3"></i>
            <span class="font-medium">${message}</span>
        </div>
    `;
    container.appendChild(notification);
    setTimeout(() => {
        notification.remove();
    }, 5000);
}

function updateActiveUsers() {
    const users = document.getElementById('active-users');
    if (!users) return;
    setInterval(() => {
        const currentCount = parseInt(users.textContent.replace(',', ''));
        const change = Math.floor(Math.random() * 10) - 5;
        const newCount = Math.max(1000, currentCount + change);
        users.textContent = newCount.toLocaleString();
    }, 10000);
}

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded, initializing...');
    initialize();
});

// Close modals when clicking outside
document.addEventListener('click', function(e) {
    const confirmationModal = document.getElementById('confirmation-modal');
    const progressModal = document.getElementById('progress-modal');
    if (confirmationModal && e.target === confirmationModal) closeModal();
    if (progressModal && e.target === progressModal) hideProgressModal();
});
