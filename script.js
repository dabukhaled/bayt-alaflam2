
// Global State & Initialization
let appData = {
    movies: [],
    settings: {
        fullPassword: '5555',
        familyPassword: '565999',
        loginPageEnabled: true,
        familyMode: false
    },
    currentSection: 'all',
    currentPage: 1,
    itemsPerPage: 100,
    zoomLevel: 100,
    accessMode: 'guest'
};
let isInitialized = false;
let dataWorker; // Make worker global so it can be accessed by the load more button

// Attach primary event listeners on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded. Attaching events.");
    
    // Setup UI interactions
    setupDragAndDrop();
    setupSearchSuggestions();
    setupHeaderScrollBehavior();
    setupZoomToggle();

    // Add listener for the new 'Load More' button
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    if (loadMoreBtn) {
        loadMoreBtn.addEventListener('click', () => {
            if (dataWorker) {
                loadMoreBtn.textContent = 'جاري التحميل...';
                loadMoreBtn.disabled = true;
                dataWorker.postMessage({ command: 'loadNextChunk' });
            }
        });
    }
    
    // Attempt to auto-login
    checkAutoLogin();
});

// --- Core Application Flow ---

async function checkAutoLogin() {
    const savedLogin = localStorage.getItem('app_login');
    if (savedLogin) {
        console.log("Auto-login data found. Initializing application.");
        try {
            const loginData = JSON.parse(savedLogin);
            appData.accessMode = loginData.accessMode;
            if (appData.accessMode === 'family') {
                appData.settings.familyMode = true;
            }
            await initializeApplication();
        } catch (e) {
            console.error("Corrupted auto-login data.", e);
            localStorage.removeItem('app_login');
        }
    } else {
        console.log("No auto-login data. Waiting for user to log in.");
    }
}

async function checkPassword() {
    const password = document.getElementById('passwordInput').value;
    let loggedIn = false;

    // Load settings from localStorage ONLY when the user tries to log in.
    const savedData = localStorage.getItem('app_database');
    if (savedData) {
        try {
            const parsed = JSON.parse(savedData);
            if (parsed.settings) {
                appData.settings = { ...appData.settings, ...parsed.settings };
            }
        } catch (e) { console.error("Could not parse settings on login attempt:", e); }
    }

    if (password === appData.settings.fullPassword) {
        appData.accessMode = 'full';
        localStorage.setItem('app_login', JSON.stringify({ accessMode: 'full' }));
        loggedIn = true;
    } else if (password === appData.settings.familyPassword) {
        appData.accessMode = 'family';
        appData.settings.familyMode = true;
        localStorage.setItem('app_login', JSON.stringify({ accessMode: 'family' }));
        loggedIn = true;
    }

    if (loggedIn) {
        console.log("Password correct. Initializing application.");
        await initializeApplication();
    } else {
        alert('كلمة المرور غير صحيحة');
    }
}

async function initializeApplication() {
    if (isInitialized) {
        console.log("Application already initialized.");
        return;
    }
    isInitialized = true;

    document.getElementById('loginPage').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');

    if (appData.settings.familyMode) {
        const privateMenuBtns = document.querySelectorAll('.category-menu-btn');
        privateMenuBtns.forEach((btn, index) => {
            if (index === 2 || index === 3) {
                btn.style.display = 'none';
            }
        });
    }

    // Call the new worker-based initializer
    initializeApplicationWithWorker();
}

function logout() {
    localStorage.removeItem('app_login');
    isInitialized = false;
    appData.movies = [];
    appData.settings = { fullPassword: '5555', familyPassword: '565999', loginPageEnabled: true, familyMode: false };
    document.getElementById('mainApp').classList.add('hidden');
    document.getElementById('loginPage').classList.remove('hidden');
    document.getElementById('passwordInput').value = '';
    console.log("User logged out.");
}


// --- Data Loading (Worker Based) ---

function initializeApplicationWithWorker() {
    const loadingIndicator = document.getElementById('loadingIndicator');
    const progressFill = document.getElementById('loadingProgressFill');
    const progressText = document.getElementById('loadingProgressText');
    const loadMoreContainer = document.getElementById('loadMoreContainer');
    const loadMoreBtn = document.getElementById('loadMoreBtn');

    // Hide load more button initially
    if(loadMoreContainer) loadMoreContainer.style.display = 'none';

    loadingIndicator.classList.remove('hidden');
    progressFill.style.width = '0%';
    progressText.textContent = 'بدء التحميل...';

    // Use the global worker variable
    if (dataWorker) {
        dataWorker.terminate(); // Terminate any existing worker before starting a new one
    }
    dataWorker = new Worker('worker.js');

    dataWorker.postMessage({ command: 'start' });

    let dataQueue = [];
    let isProcessingQueue = false;

    async function processQueue() {
        if (isProcessingQueue || dataQueue.length === 0) return;
        isProcessingQueue = true;

        const dataToProcess = dataQueue.shift();
        
        parseAndAddMovies(dataToProcess.payload, dataToProcess.format);

        // Only redisplay everything on the first batch
        if (dataToProcess.isFirstBatch) {
            displayMovies();
            populateSelects();
        }
        
        await new Promise(resolve => setTimeout(resolve, 50));
        isProcessingQueue = false;
        processQueue();
    }

    dataWorker.onmessage = function(e) {
        const { type, payload, format, isFirstBatch } = e.data;

        switch (type) {
            case 'data':
                dataQueue.push({ payload, format, isFirstBatch });
                processQueue();
                break;
            
            case 'settings':
                appData.settings = { ...appData.settings, ...payload };
                break;

            case 'progress':
                // Only show initial loading progress. Hide for subsequent chunks.
                if (loadingIndicator.classList.contains('hidden')) {
                    return; 
                }
                progressFill.style.width = `${payload.progress}%`;
                progressText.textContent = payload.text;
                break;

            case 'fallback':
                console.warn("Worker failed to fetch, falling back to localStorage.");
                loadData();
                updateCounters();
                displayMovies();
                populateSelects();
                loadingIndicator.classList.add('hidden');
                break;
            
            case 'chunkLoaded':
                // A new chunk has been loaded and added. Update UI.
                console.log(`Chunk ${payload.chunkNumber} loaded.`);
                updateCounters();
                displayMovies(); // Re-render the movie list with the new data
                if(loadMoreBtn) {
                    loadMoreBtn.textContent = 'تحميل المزيد من النتائج';
                    loadMoreBtn.disabled = false;
                }
                break;

            case 'done':
                const finalCheck = setInterval(() => {
                    if (dataQueue.length === 0 && !isProcessingQueue) {
                        clearInterval(finalCheck);
                        console.log("Worker finished a task. Finalizing UI.");
                        updateCounters();
                        displayMovies();
                        populateSelects();
                        saveData();
                        
                        // Hide the main loading indicator only after the first batch
                        if (!loadingIndicator.classList.contains('hidden')) {
                           setTimeout(() => loadingIndicator.classList.add('hidden'), 500);
                        }

                        if (payload && payload.allChunksLoaded) {
                            console.log("All chunks have been loaded.");
                            if(loadMoreContainer) loadMoreContainer.style.display = 'none';
                            if (dataWorker) {
                                dataWorker.terminate(); // Now we can terminate the worker
                                dataWorker = null;
                            }
                        } else {
                            console.log("Initial chunk loaded. More chunks available.");
                            if(loadMoreContainer) loadMoreContainer.style.display = 'block';
                            if(loadMoreBtn) {
                                loadMoreBtn.textContent = 'تحميل المزيد من النتائج';
                                loadMoreBtn.disabled = false;
                            }
                        }
                    }
                }, 100);
                break;

            case 'error':
                console.error('Error from worker:', payload);
                progressText.textContent = 'فشل تحميل البيانات!';
                loadingIndicator.classList.add('hidden');
                if (dataWorker) {
                    dataWorker.terminate();
                    dataWorker = null;
                }
                break;
        }
    };

    dataWorker.onerror = function(e) {
        console.error('An error occurred in the worker:', e);
        progressText.textContent = 'فشل حاد في أداة التحميل!';
        loadingIndicator.classList.add('hidden');
        if (dataWorker) {
            dataWorker.terminate();
            dataWorker = null;
        }
    };
}

function parseAndAddMovies(movies, format = 'default') {
    movies.forEach(movie => {
        let movieData;
        
        if (format === 'alternate') {
            movieData = {
                id: movie.id || `movie_${Date.now()}_${Math.random()}`,
                title: movie.name || 'بدون عنوان',
                imageUrl: movie.img || 'https://via.placeholder.com/200x300?text=No+Image',
                link: movie.href || '#',
                category: movie.category || 'all',
                hidden: movie.hidden || false,
                site: extractSiteName(movie.href || ''),
                dateAdded: movie.dateAdded || movie.addedDate || new Date().toISOString(),
                isFavorite: movie.star ? true : false
            };
        } else {
            movieData = {
                id: movie.movies_id || movie.id || `movie_${Date.now()}_${Math.random()}`,
                title: movie.movies_name || movie.series_name || movie.name || 'بدون عنوان',
                imageUrl: movie.movies_img || movie.series_img || movie.img || 'https://via.placeholder.com/200x300?text=No+Image',
                link: movie.movies_href || movie.series_href || movie.href || '#',
                category: movie.movies_category || movie.category || 'all',
                hidden: movie.movies_hidden || movie.hidden || false,
                site: extractSiteName(movie.movies_href || movie.series_href || movie.href || ''),
                dateAdded: movie.dateAdded || movie.addedDate || new Date().toISOString(),
                isFavorite: movie.isFavorite || false
            };
        }
        
        const exists = appData.movies.find(m => m.id === movieData.id);
        if (!exists) {
            appData.movies.push(movieData);
        }
    });
}

function loadData() {
    try {
        const savedData = localStorage.getItem('app_database');
        if (savedData) {
            const parsed = JSON.parse(savedData);
            if (parsed.movies_info) {
                // This is a fallback and might be slow, but it's better than nothing
                // if file loading fails.
                appData.movies = parsed.movies_info.map((movie, index) => ({
                    id: movie.movies_id || `movie_${Date.now()}_${index}`,
                    title: movie.movies_name || movie.series_name || 'بدون عنوان',
                    imageUrl: movie.movies_img || movie.series_img || 'https://via.placeholder.com/200x300?text=No+Image',
                    link: movie.movies_href || movie.series_href || '#',
                    category: movie.movies_category || 'all',
                    hidden: movie.movies_hidden || false,
                    site: extractSiteName(movie.movies_href || movie.series_href || ''),
                    dateAdded: movie.dateAdded || new Date().toISOString(),
                    isFavorite: movie.isFavorite || false
                }));
            }
            if (parsed.settings) {
                appData.settings = { ...appData.settings, ...parsed.settings };
            }
        }
    } catch (error) {
        console.error('Error loading data from localStorage:', error);
    }
}

function saveData() {
    try {
        const dataToSave = {
            movies_info: appData.movies.map(movie => ({
                movies_id: movie.id,
                movies_name: movie.title,
                movies_img: movie.imageUrl,
                movies_href: movie.link,
                movies_category: movie.category,
                movies_hidden: movie.hidden,
                dateAdded: movie.dateAdded,
                isFavorite: movie.isFavorite
            })),
            settings: appData.settings,
            lastSaved: new Date().toISOString()
        };
        
        const dataString = JSON.stringify(dataToSave);
        localStorage.setItem('app_database', dataString);
        console.log("Data saved to localStorage.");

    } catch (error) {
        console.error('Error saving data:', error);
        alert('حدث خطأ أثناء حفظ البيانات');
    }
}

function exportToMultipleFiles() {
    try {
        alert("سيتم الآن تقسيم البيانات. سيبدأ تنزيل الملفات واحدًا تلو الآخر. يرجى الانتظار حتى تكتمل جميع التنزيلات.");

        const allMovies = appData.movies.map(movie => ({
            movies_id: movie.id,
            movies_name: movie.title,
            movies_img: movie.imageUrl,
            movies_href: movie.link,
            movies_category: movie.category,
            movies_hidden: movie.hidden,
            dateAdded: movie.dateAdded,
            isFavorite: movie.isFavorite
        }));

        const settings = appData.settings;
        const lastSaved = new Date().toISOString();
        
        // --- Part 1: Create the initial file with 100 movies per category ---
        const initialMovies = [];
        const laterMovies = [];
        const categoryCounts = {};
        const limitPerCategory = 100;

        for (const movie of allMovies) {
            const category = movie.movies_category || 'all';
            categoryCounts[category] = categoryCounts[category] || 0;

            if (categoryCounts[category] < limitPerCategory) {
                initialMovies.push(movie);
                categoryCounts[category]++;
            } else {
                laterMovies.push(movie);
            }
        }

        const initialData = {
            movies_info: initialMovies,
            settings: settings,
            lastSaved: lastSaved
        };

        // Helper function to download a blob
        const downloadBlob = (blob, filename, delay) => {
            setTimeout(() => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                a.click();
                URL.revokeObjectURL(url);
                console.log(`تم بدء تنزيل ${filename}`);
            }, delay);
        };

        // Download the first file
        const initialBlob = new Blob([JSON.stringify(initialData, null, 2)], { type: 'application/json' });
        downloadBlob(initialBlob, 'app_database1.json', 500);

        // --- Part 2: Create subsequent files with a 5MB limit ---
        const maxSize = 5 * 1024 * 1024; // 5 MB
        const movieChunks = [];
        let currentChunk = [];

        for (const movie of laterMovies) {
            currentChunk.push(movie);
            // Check size with only movies_info, as settings are not included in these chunks
            if (JSON.stringify({ movies_info: currentChunk }).length > maxSize) {
                const lastMovie = currentChunk.pop(); // remove the movie that pushed it over the limit
                movieChunks.push(currentChunk);
                currentChunk = lastMovie ? [lastMovie] : []; // start new chunk with that movie
            }
        }
        if (currentChunk.length > 0) {
            movieChunks.push(currentChunk);
        }

        // Download the rest of the chunks
        movieChunks.forEach((chunk, index) => {
            const chunkData = {
                movies_info: chunk,
                lastSaved: lastSaved // No settings in subsequent files
            };
            const blob = new Blob([JSON.stringify(chunkData, null, 2)], { type: 'application/json' });
            const fileCount = index + 2; // Start naming from app_database2.json
            downloadBlob(blob, `app_database${fileCount}.json`, 500 + (index + 1) * 800);
        });

        const totalFiles = movieChunks.length + 1;
        setTimeout(() => {
            alert(`اكتمل التصدير! تم إنشاء ${totalFiles} ملفات. يرجى إنشاء مجلد باسم "database_chunks" ووضع جميع الملفات التي تم تنزيلها بداخله.`);
        }, 500 + totalFiles * 800);

    } catch (error) {
        console.error('Error exporting to multiple files:', error);
        alert('حدث خطأ أثناء تصدير البيانات');
    }
}

function extractSiteName(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname.replace('www.', '');
    } catch {
        return 'unknown';
    }
}

const sectionsAllowingDuplicates = [
    'franchises', 'indian', 'horror', 'stars',
    'selected1', 'selected2', 'favorites1', 'favorites2',
    'selected_r', 'selected_s', 'selected_x', 'thursday_night'
];

function isDuplicateMovie(link, category) {
    if (sectionsAllowingDuplicates.includes(category)) {
        return false;
    }
    return appData.movies.some(m => m.link === link);
}

function quickAddMovie() {
    const link = document.getElementById('quickAddLink').value.trim();
    const name = document.getElementById('quickAddName').value.trim();
    const category = document.getElementById('quickAddCategory').value;
    
    if (!link || !category) {
        alert('الرجاء إدخال رابط الفيلم واختيار القسم');
        return;
    }
    
    if (isDuplicateMovie(link, category)) {
        alert('هذا الفيلم موجود بالفعل في المكتبة');
        return;
    }
    
    const movie = {
        id: `movie_${Date.now()}`,
        title: name || 'فيلم بدون عنوان',
        imageUrl: 'https://via.placeholder.com/200x300?text=Movie',
        link: link,
        category: category,
        hidden: false,
        site: extractSiteName(link),
        dateAdded: new Date().toISOString(),
        isFavorite: false
    };
    
    appData.movies.push(movie);
    saveData();
    updateCounters();
    
    if (appData.currentSection === category || appData.currentSection === 'all') {
        displayMovies();
    }
    
    document.getElementById('quickAddLink').value = '';
    document.getElementById('quickAddName').value = '';
    alert('تم إضافة الفيلم بنجاح');
}

function searchInternal() {
    const query = document.getElementById('searchInput').value.toLowerCase().trim();
    if (!query) {
        alert('الرجاء إدخال كلمة البحث');
        return;
    }
    
    const results = appData.movies.filter(movie => 
        movie.title.toLowerCase().includes(query) && !movie.hidden
    );
    
    if (results.length === 0) {
        alert('لا توجد نتائج للبحث');
        return;
    }
    
    const container = document.getElementById('moviesContainer');
    container.innerHTML = '';
    
    const header = document.createElement('div');
    header.style.cssText = 'grid-column: 1 / -1; text-align: center; padding: 1rem; color: hsl(var(--accent-gold)); font-size: 1.3rem; font-weight: bold;';
    header.textContent = `نتائج البحث: ${results.length} فيلم`;
    container.appendChild(header);
    
    results.forEach(movie => {
        const card = createMovieCard(movie);
        container.appendChild(card);
    });
    
    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function searchGoogle() {
    const query = document.getElementById('searchInput').value.trim();
    if (query) {
        window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, '_blank');
    }
}

function searchYandex() {
    const query = document.getElementById('searchInput').value.trim();
    if (query) {
        window.open(`https://yandex.com/search/?text=${encodeURIComponent(query)}`, '_blank');
    }
}

function setupSearchSuggestions() {
    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('input', () => {
        const query = searchInput.value.toLowerCase().trim();
        if (query.length < 2) return;
        
        const matches = appData.movies
            .filter(m => m.title.toLowerCase().includes(query) && !m.hidden)
            .slice(0, 5);
    });
}

function displayMovies() {
    const container = document.getElementById('moviesContainer');
    container.innerHTML = '';
    
    let moviesToShow = appData.movies.filter(movie => {
        if (movie.hidden) return false;
        if (appData.currentSection === 'all') return true;
        return movie.category === appData.currentSection;
    });
    
    const sortBy = document.getElementById('sortBy').value;
    const siteSort = document.getElementById('siteSort').value;

    if (sortBy === 'site' && siteSort) {
        moviesToShow = moviesToShow.filter(movie => movie.site === siteSort);
    }
    
    moviesToShow = sortMovies(moviesToShow, sortBy);
    
    const startIndex = (appData.currentPage - 1) * appData.itemsPerPage;
    const endIndex = startIndex + appData.itemsPerPage;
    const paginatedMovies = moviesToShow.slice(startIndex, endIndex);
    
    paginatedMovies.forEach(movie => {
        const card = createMovieCard(movie);
        container.appendChild(card);
    });
    
    updatePagination(moviesToShow.length);
}

function createMovieCard(movie) {
    const card = document.createElement('div');
    card.className = 'movie-card';
    
    card.innerHTML = `
        <div class="movie-poster-container">
            <span class="movie-site" title="${movie.site}">${movie.site}</span>
            <img src="${movie.imageUrl}" alt="${movie.title}" class="movie-poster" 
                 onerror="this.src='https://via.placeholder.com/200x300?text=No+Image'">
            <div class="movie-title-overlay">
                <h3 class="movie-title" title="${movie.title}">${movie.title}</h3>
            </div>
        </div>
        <div class="movie-info">
            <div class="movie-actions">
                <button class="btn-favorite ${movie.isFavorite ? 'active' : ''}" 
                        onclick="toggleFavorite('${movie.id}')" title="إضافة للمفضلة">⭐</button>
                <button class="btn-edit" onclick="openEditModal('${movie.id}')" title="تعديل">⋮</button>
            </div>
        </div>
    `;
    
    const titleElement = card.querySelector('.movie-title');
    titleElement.addEventListener('mouseup', function() {
        const selectedText = window.getSelection().toString().trim();
        if (selectedText) {
            navigator.clipboard.writeText(selectedText).then(() => {
                console.log('تم نسخ النص: ' + selectedText);
            }).catch(err => {
                console.error('فشل النسخ:', err);
            });
        }
    });
    
    card.addEventListener('click', (e) => {
        if (!e.target.closest('.movie-actions') && !e.target.closest('.movie-title')) {
            window.open(movie.link, '_blank');
        }
    });
    
    return card;
}

function sortMovies(movies, sortBy) {
    const sorted = [...movies];
    switch (sortBy) {
        case 'date_asc':
            return sorted.sort((a, b) => new Date(a.dateAdded) - new Date(b.dateAdded));
        case 'date_desc':
            return sorted.sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded));
        case 'name_asc':
            return sorted.sort((a, b) => a.title.localeCompare(b.title, 'ar'));
        case 'name_desc':
            return sorted.sort((a, b) => b.title.localeCompare(a.title, 'ar'));
        case 'site':
            return sorted.sort((a, b) => a.site.localeCompare(b.site));
        default:
            return sorted;
    }
}

function handleSortChange() {
    const sortBy = document.getElementById('sortBy').value;
    const siteSortContainer = document.getElementById('siteSortContainer');
    
    if (sortBy === 'site') {
        populateSiteSort();
        siteSortContainer.classList.remove('hidden');
    } else {
        siteSortContainer.classList.add('hidden');
    }
    
    applySorting();
}

function populateSiteSort() {
    const siteSortSelect = document.getElementById('siteSort');
    const moviesInCurrentSection = appData.movies.filter(movie => {
        if (movie.hidden) return false;
        if (appData.currentSection === 'all') return true;
        return movie.category === appData.currentSection;
    });
    
    const sites = [...new Set(moviesInCurrentSection.map(m => m.site))].sort();
    
    siteSortSelect.innerHTML = '<option value="">كل المواقع</option>';
    sites.forEach(site => {
        const option = document.createElement('option');
        option.value = site;
        option.textContent = site;
        siteSortSelect.appendChild(option);
    });
}

function applySorting() {
    displayMovies();
}

function showSection(section) {
    appData.currentSection = section;
    appData.currentPage = 1;

    const clickedButton = event.target.closest('.section-btn, .category-menu-btn');

    document.querySelectorAll('.section-btn, .category-menu-btn').forEach(btn => btn.classList.remove('active'));
    if (clickedButton) {
        clickedButton.classList.add('active');
    }
    
    const sectionTitleEl = document.getElementById('sectionTitle');
    if (sectionTitleEl && clickedButton) {
        const buttonClone = clickedButton.cloneNode(true);
        const counterSpan = buttonClone.querySelector('.counter');
        if (counterSpan) {
            counterSpan.remove();
        }
        sectionTitleEl.textContent = buttonClone.textContent.trim();
    }

    displayMovies();
    
    const moviesContainer = document.getElementById('moviesContainer');
    if (moviesContainer) {
        moviesContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function updateCounters() {
    const sections = [
        'all', 'old_arabic', 'new_arabic', 'series', 'foreign1', 'foreign2', 'foreign3',
        'franchises', 'indian', 'asian', 'horror', 'stars', 'various', 'sites',
        'selected1', 'selected2', 'favorites1', 'favorites2',
        'r1', 'r2', 's1', 's2', 'x1', 'xsites', 'selected_r', 'selected_s', 'selected_x', 'thursday_night'
    ];
    
    sections.forEach(section => {
        const count = section === 'all' 
            ? appData.movies.filter(m => !m.hidden).length
            : appData.movies.filter(m => m.category === section && !m.hidden).length;
        
        const counter = document.getElementById(`counter-${section}`);
        if (counter) counter.textContent = count;
    });
}

function toggleFavorite(movieId) {
    const movie = appData.movies.find(m => m.id === movieId);
    if (!movie) return;
    
    const generalMainSections = ['old_arabic', 'new_arabic', 'series', 'foreign1', 'foreign2', 'foreign3', 'franchises', 'indian', 'asian', 'horror', 'stars', 'various'];
    const r_sections = ['r1', 'r2'];
    const s_sections = ['s1', 's2'];
    const x_sections = ['x1', 'xsites'];
    
    let subsectionOptions = [];
    
    if (generalMainSections.includes(movie.category)) {
        subsectionOptions = [
            { value: 'selected1', label: 'أفلام مختارة 1' },
            { value: 'selected2', label: 'أفلام مختارة 2' },
            { value: 'favorites1', label: 'المفضلة 1' },
            { value: 'favorites2', label: 'المفضلة 2' }
        ];
    } else if (r_sections.includes(movie.category)) {
        subsectionOptions = [
            { value: 'selected_r', label: 'أفلام مختارة R' },
            { value: 'thursday_night', label: 'قسم ليلة الخميس' }
        ];
    } else if (s_sections.includes(movie.category)) {
        subsectionOptions = [
            { value: 'selected_s', label: 'أفلام مختارة S' },
            { value: 'thursday_night', label: 'قسم ليلة الخميس' }
        ];
    } else if (x_sections.includes(movie.category)) {
        subsectionOptions = [
            { value: 'selected_x', label: 'أفلام مختارة X' },
            { value: 'thursday_night', label: 'قسم ليلة الخميس' }
        ];
    } else {
        return;
    }
    
    const dialog = document.createElement('div');
    dialog.className = 'favorite-dialog';
    dialog.innerHTML = `
        <div class="favorite-dialog-content">
            <h3>اختر القسم الفرعي</h3>
            <div class="subsection-options">
                ${subsectionOptions.map(opt => `
                    <button class="subsection-btn" data-value="${opt.value}">
                        ${opt.label}
                    </button>
                `).join('')}
            </div>
            <button class="btn-cancel" onclick="this.closest('.favorite-dialog').remove()">إلغاء</button>
        </div>
    `;
    
    document.body.appendChild(dialog);
    
    dialog.querySelectorAll('.subsection-btn').forEach(btn => {
        btn.onclick = () => {
            const targetCategory = btn.dataset.value;
            
            const favoriteMovie = {
                ...movie,
                id: 'fav-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
                category: targetCategory,
                isFavorite: true
            };
            
            appData.movies.push(favoriteMovie);
            
            movie.isFavorite = true;
            
            saveData();
            updateCounters();
            displayMovies();
            dialog.remove();
        };
    });
}

function openEditModal(movieId) {
    const movie = appData.movies.find(m => m.id === movieId);
    if (!movie) return;
    
    document.getElementById('editMovieId').value = movie.id;
    document.getElementById('editMovieName').value = movie.title;
    document.getElementById('editMovieLink').value = movie.link;
    document.getElementById('editMovieImage').value = movie.imageUrl;
    
    const categorySelect = document.getElementById('editMovieCategory');
    populateCategorySelect(categorySelect);
    categorySelect.value = movie.category;
    
    document.getElementById('editModal').classList.remove('hidden');
    
    const inputs = document.querySelectorAll('#editModal input[type="text"], #editModal select');
    inputs.forEach(input => {
        input.addEventListener('click', function() {
            this.select();
        });
    });
}

function closeEditModal() {
    document.getElementById('editModal').classList.add('hidden');
}

function saveMovieEdit() {
    const movieId = document.getElementById('editMovieId').value;
    const movie = appData.movies.find(m => m.id === movieId);
    
    if (movie) {
        movie.title = document.getElementById('editMovieName').value;
        movie.link = document.getElementById('editMovieLink').value;
        movie.imageUrl = document.getElementById('editMovieImage').value;
        movie.category = document.getElementById('editMovieCategory').value;
        movie.site = extractSiteName(movie.link);
        
        saveData();
        updateCounters();
        displayMovies();
        closeEditModal();
        alert('تم حفظ التغييرات بنجاح');
    }
}

function deleteMovie() {
    const movieId = document.getElementById('editMovieId').value;
    if (confirm('هل أنت متأكد من حذف هذا الفيلم؟')) {
        appData.movies = appData.movies.filter(m => m.id !== movieId);
        saveData();
        updateCounters();
        displayMovies();
        closeEditModal();
    }
}

function updatePagination(totalItems) {
    const totalPages = Math.ceil(totalItems / appData.itemsPerPage);
    const pageNumbers = document.getElementById('pageNumbers');
    pageNumbers.innerHTML = '';
    
    const startPage = Math.max(1, appData.currentPage - 5);
    const endPage = Math.min(totalPages, startPage + 9);
    
    for (let i = startPage; i <= endPage; i++) {
        const btn = document.createElement('button');
        btn.className = `btn-page ${i === appData.currentPage ? 'active' : ''}`;
        btn.textContent = i;
        btn.onclick = () => changePage(i);
        pageNumbers.appendChild(btn);
    }
}

function changePage(direction) {
    const totalItems = appData.movies.filter(m => {
        if (m.hidden) return false;
        if (appData.currentSection === 'all') return true;
        return m.category === appData.currentSection;
    }).length;
    const totalPages = Math.ceil(totalItems / appData.itemsPerPage);
    
    if (direction === 'prev') {
        appData.currentPage = Math.max(1, appData.currentPage - 1);
    } else if (direction === 'next') {
        appData.currentPage = Math.min(totalPages, appData.currentPage + 1);
    } else if (direction === 'last') {
        appData.currentPage = totalPages;
    } else if (typeof direction === 'number') {
        appData.currentPage = direction;
    }
    
    displayMovies();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function changeZoom(delta) {
    appData.zoomLevel = Math.max(50, Math.min(200, appData.zoomLevel + delta));
    document.getElementById('zoomLevel').textContent = `${appData.zoomLevel}%`;
    document.body.style.zoom = `${appData.zoomLevel}%`;
}

function setupZoomToggle() {
    const zoomToggle = document.getElementById('zoomToggle');
    const zoomControl = document.querySelector('.zoom-control');

    zoomToggle.addEventListener('click', () => {
        zoomControl.classList.toggle('visible');
    });
}

function toggleControlPanel() {
    const panel = document.getElementById('controlPanel');
    
    if (!panel.classList.contains('hidden')) {
        panel.classList.add('hidden');
        return;
    }
    
    const password = prompt('الرجاء إدخال كلمة مرور لوحة التحكم:');
    
    if (password === appData.settings.fullPassword) {
        panel.classList.remove('hidden');
    } else {
        alert('كلمة المرور غير صحيحة');
    }
}

function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
    
    event.target.classList.add('active');
    document.getElementById(tabName + 'Tab').classList.add('active');
}

function changePassword(type) {
    const newPassword = document.getElementById(type === 'full' ? 'newFullPassword' : 'newFamilyPassword').value;
    if (!newPassword) {
        alert('الرجاء إدخال كلمة المرور الجديدة');
        return;
    }
    
    if (type === 'full') {
        appData.settings.fullPassword = newPassword;
    } else {
        appData.settings.familyPassword = newPassword;
    }
    
    saveData();
    alert('تم تغيير كلمة المرور بنجاح');
}

function toggleLoginPage() {
    appData.settings.loginPageEnabled = document.getElementById('loginPageToggle').checked;
    saveData();
}

function toggleFamilyMode() {
    appData.settings.familyMode = document.getElementById('familyModeToggle').checked;
    
    const privateMenuBtns = document.querySelectorAll('.category-menu-btn');
    privateMenuBtns.forEach((btn, index) => {
        if (index === 2 || index === 3) {
            btn.style.display = appData.settings.familyMode ? 'none' : 'flex';
        }
    });
    
    if (appData.settings.familyMode) {
        document.getElementById('privateSections').classList.add('hidden');
        document.getElementById('privateFavoritesSections').classList.add('hidden');
    }
    
    saveData();
}

function exportAllData() {
    const dataToExport = {
        movies_info: appData.movies.map(movie => ({
            movies_id: movie.id,
            movies_name: movie.title,
            movies_img: movie.imageUrl,
            movies_href: movie.link,
            movies_category: movie.category,
            movies_hidden: movie.hidden,
            dateAdded: movie.dateAdded,
            isFavorite: movie.isFavorite
        })),
        settings: appData.settings,
        exportDate: new Date().toISOString()
    };
    
    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `app_database_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function importAllData() {
    const file = document.getElementById('importDataFile').files[0];
    if (!file) return;
    
    const progressBar = document.getElementById('importProgress');
    const progressFill = document.getElementById('importProgressBar');
    const progressText = document.getElementById('importProgressText');
    
    progressBar.classList.remove('hidden');
    progressFill.style.width = '0%';
    progressText.textContent = 'جارٍ قراءة الملف...';
    
    const reader = new FileReader();
    
    reader.onload = async (e) => {
        try {
            progressText.textContent = 'جارٍ تحليل البيانات...';
            progressFill.style.width = '10%';
            await new Promise(resolve => setTimeout(resolve, 50));
            
            const data = JSON.parse(e.target.result);
            
            let movies = [];
            if (data.movies_info) {
                movies = data.movies_info;
            } else if (data.movies) {
                movies = data.movies;
            }
            
            progressText.textContent = `جارٍ استرداد ${movies.length} فيلم...`;
            progressFill.style.width = '20%';
            
            const batchSize = 100;
            const totalMovies = movies.length;
            let processedCount = 0;
            
            for (let i = 0; i < movies.length; i += batchSize) {
                const batch = movies.slice(i, i + batchSize);
                
                batch.forEach(newMovie => {
                    let movieData;
                    
                    if (newMovie.movies_id || newMovie.movies_name) {
                        movieData = {
                            id: newMovie.movies_id || `movie_${Date.now()}_${Math.random()}`,
                            title: newMovie.movies_name || 'بدون عنوان',
                            imageUrl: newMovie.movies_img || 'https://via.placeholder.com/200x300',
                            link: newMovie.movies_href || '#',
                            category: newMovie.movies_category || 'all',
                            hidden: newMovie.movies_hidden || false,
                            site: extractSiteName(newMovie.movies_href || ''),
                            dateAdded: newMovie.dateAdded || new Date().toISOString(),
                            isFavorite: newMovie.isFavorite || false
                        };
                    } else {
                        movieData = {
                            id: newMovie.id || `movie_${Date.now()}_${Math.random()}`,
                            title: newMovie.name || 'بدون عنوان',
                            imageUrl: newMovie.img || 'https://via.placeholder.com/200x300',
                            link: newMovie.href || '#',
                            category: newMovie.category || 'all',
                            hidden: newMovie.hidden || false,
                            site: extractSiteName(newMovie.href || ''),
                            dateAdded: newMovie.dateAdded || newMovie.addedDate || new Date().toISOString(),
                            isFavorite: newMovie.star ? true : false
                        };
                    }
                    
                    const exists = appData.movies.find(m => m.id === movieData.id);
                    const isDuplicate = isDuplicateMovie(movieData.link, movieData.category);
                    
                    if (!exists && !isDuplicate) {
                        appData.movies.push(movieData);
                    }
                    processedCount++;
                });
                
                const progress = 20 + (processedCount / totalMovies) * 70;
                progressFill.style.width = `${progress}%`;
                progressText.textContent = `تم معالجة ${processedCount} من ${totalMovies} فيلم (${Math.round((processedCount / totalMovies) * 100)}%)`;
                
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            
            if (data.settings) {
                appData.settings = { ...appData.settings, ...data.settings };
            }
            
            progressText.textContent = 'جارٍ حفظ البيانات...';
            progressFill.style.width = '95%';
            await new Promise(resolve => setTimeout(resolve, 50));
            
            saveData();
            updateCounters();
            displayMovies();
            
            progressFill.style.width = '100%';
            progressText.textContent = `تم بنجاح! (${processedCount} فيلم)`;
            
            setTimeout(() => {
                progressBar.classList.add('hidden');
                progressFill.style.width = '0%';
                progressText.textContent = '0%';
                alert(`تم استيراد ${processedCount} فيلم بنجاح`);
            }, 1000);
        } catch (error) {
            progressBar.classList.add('hidden');
            alert('خطأ في قراءة الملف: ' + error.message);
            console.error(error);
        }
    };
    
    reader.onerror = () => {
        progressBar.classList.add('hidden');
        alert('فشل في قراءة الملف');
    };
    
    reader.readAsText(file);
}

function deleteAllData() {
    if (confirm('هل أنت متأكد من حذف جميع البيانات؟ لا يمكن التراجع عن هذا الإجراء!')) {
        if (confirm('تأكيد نهائي: سيتم حذف جميع الأفلام والإعدادات!')) {
            appData.movies = [];
            saveData();
            updateCounters();
            displayMovies();
            alert('تم حذف جميع البيانات');
        }
    }
}

async function bulkAddMovies() {
    const files = document.getElementById('bulkAddFile').files;
    const section = document.getElementById('bulkAddSection').value;
    
    if (files.length === 0 || !section) {
        alert('الرجاء اختيار ملف JSON (أو عدة ملفات) والقسم');
        return;
    }
    
    let totalAdded = 0;
    
    for (let file of files) {
        const reader = new FileReader();
        
        await new Promise((resolve) => {
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    
                    let movies = [];
                    if (data.movies_info) {
                        movies = data.movies_info;
                    } else if (data.movies) {
                        movies = data.movies;
                    } else if (data.series_info) {
                        movies = data.series_info;
                    }
                    
                    movies.forEach(movie => {
                        const movieData = {
                            id: movie.id || movie.movies_id || `movie_${Date.now()}_${Math.random()}`,
                            title: movie.name || movie.movies_name || movie.series_name || 'بدون عنوان',
                            imageUrl: movie.img || movie.movies_img || movie.series_img || 'https://via.placeholder.com/200x300',
                            link: movie.href || movie.movies_href || movie.series_href || '#',
                            category: section,
                            hidden: false,
                            site: extractSiteName(movie.href || movie.movies_href || movie.series_href || ''),
                            dateAdded: movie.dateAdded || movie.addedDate || new Date().toISOString(),
                            isFavorite: false
                        };
                        
                        if (!isDuplicateMovie(movieData.link, section)) {
                            appData.movies.push(movieData);
                            totalAdded++;
                        }
                    });
                    
                } catch (error) {
                    console.error('خطأ في قراءة الملف:', file.name, error);
                }
                resolve();
            };
            reader.readAsText(file);
        });
    }
    
    saveData();
    updateCounters();
    displayMovies();
    alert(`تم إضافة ${totalAdded} فيلم من ${files.length} ملف بنجاح`);
}

function manualAddMovie() {
    const name = document.getElementById('manualMovieName').value.trim();
    const link = document.getElementById('manualMovieLink').value.trim();
    const image = document.getElementById('manualMovieImage').value.trim();
    const section = document.getElementById('manualMovieSection').value;
    
    if (!name || !link || !section) {
        alert('الرجاء ملء جميع الحقول المطلوبة');
        return;
    }
    
    if (isDuplicateMovie(link, section)) {
        alert('هذا الفيلم موجود بالفعل في المكتبة');
        return;
    }
    
    appData.movies.push({
        id: `movie_${Date.now()}`,
        title: name,
        imageUrl: image || 'https://via.placeholder.com/200x300',
        link: link,
        category: section,
        hidden: false,
        site: extractSiteName(link),
        dateAdded: new Date().toISOString(),
        isFavorite: false
    });
    
    saveData();
    updateCounters();
    displayMovies();
    
    document.getElementById('manualMovieName').value = '';
    document.getElementById('manualMovieLink').value = '';
    document.getElementById('manualMovieImage').value = '';
    alert('تم إضافة الفيلم بنجاح');
}

function populateSelects() {
    const selects = [
        'bulkAddSection',
        'manualMovieSection',
        'selectedSection',
        'targetSection',
        'targetSectionForSite'
    ];
    
    const categories = [
        { value: 'all', label: 'جميع الأفلام والمسلسلات' },
        { value: 'old_arabic', label: 'الأفلام العربية القديمة' },
        { value: 'new_arabic', label: 'الأفلام العربية الجديدة' },
        { value: 'series', label: 'المسلسلات' },
        { value: 'foreign1', label: 'الأفلام الأجنبية 1' },
        { value: 'foreign2', label: 'الأفلام الأجنبية 2' },
        { value: 'foreign3', label: 'الأفلام الأجنبية 3' },
        { value: 'franchises', label: 'سلاسل الأفلام' },
        { value: 'indian', label: 'الأفلام الهندية' },
        { value: 'asian', label: 'الأفلام الآسيوية' },
        { value: 'horror', label: 'أفلام الرعب' },
        { value: 'stars', label: 'أفلام النجوم' },
        { value: 'various', label: 'الأفلام المتنوعة' },
        { value: 'selected1', label: 'أفلام مختارة 1' },
        { value: 'selected2', label: 'أفلام مختارة 2' },
        { value: 'favorites1', label: 'المفضلة 1' },
        { value: 'favorites2', label: 'المفضلة 2' }
    ];
    
    if (appData.accessMode === 'full') {
        categories.push(
            { value: 'r1', label: 'الأفلام R1' },
            { value: 'r2', label: 'الأفلام R2' },
            { value: 's1', label: 'الأفلام S1' },
            { value: 's2', label: 'الأفلام S2' },
            { value: 'x1', label: 'الأفلام X1' },
            { value: 'xsites', label: 'X SITES' },
            { value: 'selected_r', label: 'أفلام مختارة R' },
            { value: 'selected_s', label: 'أفلام مختارة S' },
            { value: 'selected_x', label: 'أفلام مختارة X' },
            { value: 'thursday_night', label: 'قسم ليلة الخميس' }
        );
    }
    
    selects.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (select) {
            select.innerHTML = '<option value="">اختر القسم</option>';
            categories.forEach(cat => {
                const option = document.createElement('option');
                option.value = cat.value;
                option.textContent = cat.label;
                select.appendChild(option);
            });
        }
    });
    
    const sites = [...new Set(appData.movies.map(m => m.site))].sort();
    const siteSelect = document.getElementById('selectedSite');
    if (siteSelect) {
        siteSelect.innerHTML = '<option value="">اختر الموقع</option>';
        sites.forEach(site => {
            const option = document.createElement('option');
            option.value = site;
            option.textContent = site;
            siteSelect.appendChild(option);
        });
    }
}

function populateCategorySelect(select) {
    const categories = [
        { value: 'all', label: 'جميع الأفلام والمسلسلات' },
        { value: 'old_arabic', label: 'الأفلام العربية القديمة' },
        { value: 'new_arabic', label: 'الأفلام العربية الجديدة' },
        { value: 'series', label: 'المسلسلات' },
        { value: 'foreign1', label: 'الأفلام الأجنبية 1' },
        { value: 'foreign2', label: 'الأفلام الأجنبية 2' },
        { value: 'foreign3', label: 'الأفلام الأجنبية 3' },
        { value: 'franchises', label: 'سلاسل الأفلام' },
        { value: 'indian', label: 'الأفلام الهندية' },
        { value: 'asian', label: 'الأفلام الآسيوية' },
        { value: 'horror', label: 'أفلام الرعب' },
        { value: 'stars', label: 'أفلام النجوم' },
        { value: 'various', label: 'الأفلام المتنوعة' },
        { value: 'selected1', label: 'أفلام مختارة 1' },
        { value: 'selected2', label: 'أفلام مختارة 2' },
        { value: 'favorites1', label: 'المفضلة 1' },
        { value: 'favorites2', label: 'المفضلة 2' }
    ];
    
    select.innerHTML = '';
    categories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat.value;
        option.textContent = cat.label;
        select.appendChild(option);
    });
}

function showSectionInfo() {
    const section = document.getElementById('selectedSection').value;
    if (!section) return;
    
    const count = appData.movies.filter(m => m.category === section && !m.hidden).length;
    document.getElementById('sectionInfo').textContent = `يحتوي هذا القسم على ${count} فيلم`;
}

function moveMovies() {
    const fromSection = document.getElementById('selectedSection').value;
    const toSection = document.getElementById('targetSection').value;
    
    if (!fromSection || !toSection) {
        alert('الرجاء اختيار القسم المصدر والهدف');
        return;
    }
    
    let count = 0;
    appData.movies.forEach(movie => {
        if (movie.category === fromSection) {
            movie.category = toSection;
            count++;
        }
    });
    
    saveData();
    updateCounters();
    displayMovies();
    alert(`تم نقل ${count} فيلم`);
}

function deleteSectionMovies() {
    const section = document.getElementById('selectedSection').value;
    if (!section) {
        alert('الرجاء اختيار القسم');
        return;
    }
    
    if (confirm(`هل أنت متأكد من حذف جميع الأفلام في قسم ${section}؟`)) {
        appData.movies = appData.movies.filter(m => m.category !== section);
        saveData();
        updateCounters();
        displayMovies();
        alert('تم حذف الأفلام بنجاح');
    }
}

function exportSection() {
    const section = document.getElementById('selectedSection').value;
    if (!section) {
        alert('الرجاء اختيار القسم');
        return;
    }
    
    const movies = appData.movies.filter(m => m.category === section);
    const dataToExport = {
        movies_info: movies.map(movie => ({
            movies_name: movie.title,
            movies_img: movie.imageUrl,
            movies_href: movie.link
        }))
    };
    
    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `section_${section}_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function importSection() {
    const file = document.getElementById('importSectionFile').files[0];
    const section = document.getElementById('selectedSection').value;
    
    if (!file || !section) {
        alert('الرجاء اختيار الملف والقسم');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            const movies = data.movies_info || [];
            let addedCount = 0;
            
            movies.forEach(movie => {
                const movieLink = movie.movies_href || '#';
                
                if (!isDuplicateMovie(movieLink, section)) {
                    appData.movies.push({
                        id: `movie_${Date.now()}_${Math.random()}`,
                        title: movie.movies_name || 'بدون عنوان',
                        imageUrl: movie.movies_img || 'https://via.placeholder.com/200x300',
                        link: movieLink,
                        category: section,
                        hidden: false,
                        site: extractSiteName(movieLink),
                        dateAdded: new Date().toISOString(),
                        isFavorite: false
                    });
                    addedCount++;
                }
            });
            
            saveData();
            updateCounters();
            displayMovies();
            alert(`تم استيراد ${addedCount} فيلم (تم تجاهل ${movies.length - addedCount} فيلم مكرر)`);
        } catch (error) {
            alert('خطأ في قراءة الملف');
        }
    };
    reader.readAsText(file);
}

function cleanTitles() {
    const words = document.getElementById('wordsToRemove').value.split(',').map(w => w.trim());
    const section = document.getElementById('selectedSection').value;
    
    if (!section || words.length === 0) {
        alert('الرجاء اختيار القسم وإدخال الكلمات');
        return;
    }
    
    let count = 0;
    appData.movies.forEach(movie => {
        if (movie.category === section) {
            words.forEach(word => {
                if (movie.title.includes(word)) {
                    movie.title = movie.title.replace(new RegExp(word, 'g'), '').trim();
                    count++;
                }
            });
        }
    });
    
    saveData();
    displayMovies();
    alert(`تم تنظيف ${count} عنوان`);
}

function showSiteInfo() {
    const site = document.getElementById('selectedSite').value;
    if (!site) return;
    
    const movies = appData.movies.filter(m => m.site === site && !m.hidden);
    const sections = [...new Set(movies.map(m => m.category))];
    
    document.getElementById('siteInfo').innerHTML = `
        يحتوي هذا الموقع على ${movies.length} فيلم<br>
        الأقسام: ${sections.join(', ')}
    `;
}

function hideSiteMovies() {
    const site = document.getElementById('selectedSite').value;
    if (!site) return;
    
    appData.movies.forEach(movie => {
        if (movie.site === site) {
            movie.hidden = true;
        }
    });
    
    saveData();
    updateCounters();
    displayMovies();
    updateHiddenSitesList();
    alert('تم إخفاء أفلام الموقع');
}

function showSiteMovies() {
    const site = document.getElementById('selectedSite').value;
    if (!site) return;
    
    appData.movies.forEach(movie => {
        if (movie.site === site) {
            movie.hidden = false;
        }
    });
    
    saveData();
    updateCounters();
    displayMovies();
    updateHiddenSitesList();
    alert('تم إظهار أفلام الموقع');
}

function deleteSiteMovies() {
    const site = document.getElementById('selectedSite').value;
    if (!site) return;
    
    if (confirm(`هل أنت متأكد من حذف جميع أفلام ${site}؟`)) {
        appData.movies = appData.movies.filter(m => m.site !== site);
        saveData();
        updateCounters();
        displayMovies();
        populateSelects();
        alert('تم حذف أفلام الموقع');
    }
}

function moveSiteMovies() {
    const site = document.getElementById('selectedSite').value;
    const toSection = document.getElementById('targetSectionForSite').value;
    
    if (!site || !toSection) {
        alert('الرجاء اختيار الموقع والقسم الهدف');
        return;
    }
    
    let count = 0;
    appData.movies.forEach(movie => {
        if (movie.site === site) {
            movie.category = toSection;
            count++;
        }
    });
    
    saveData();
    updateCounters();
    displayMovies();
    alert(`تم نقل ${count} فيلم`);
}

function updateHiddenSitesList() {
    const hiddenSites = [...new Set(appData.movies.filter(m => m.hidden).map(m => m.site))];
    const container = document.getElementById('hiddenSitesList');
    
    container.innerHTML = '';
    hiddenSites.forEach(site => {
        const siteDiv = document.createElement('div');
        siteDiv.style.cssText = 'margin: 10px 0; padding: 10px; background: var(--bg-tertiary); border-radius: 8px;';
        
        const movies = appData.movies.filter(m => m.site === site && m.hidden).slice(0, 5);
        const buttons = movies.map((movie, i) => 
            `<button onclick="window.open('${movie.link}', '_blank')" class="btn-secondary" style="margin: 0 5px;">▶ ${i + 1}</button>`
        ).join('');
        
        siteDiv.innerHTML = `
            <strong>${site}</strong> (${appData.movies.filter(m => m.site === site && m.hidden).length} فيلم)<br>
            ${buttons}
        `;
        
        container.appendChild(siteDiv);
    });
}

function restoreAllHidden() {
    appData.movies.forEach(movie => {
        movie.hidden = false;
    });
    
    saveData();
    updateCounters();
    displayMovies();
    updateHiddenSitesList();
    alert('تم استعادة جميع الأفلام المخفية');
}

function exportSubsections(type) {
    const subsections = type === 'general' 
        ? ['selected1', 'selected2', 'favorites1', 'favorites2']
        : ['selected_r', 'selected_s', 'selected_x'];
    
    const movies = appData.movies.filter(m => subsections.includes(m.category));
    
    const dataToExport = {
        movies_info: movies.map(movie => ({
            movies_name: movie.title,
            movies_img: movie.imageUrl,
            movies_href: movie.link,
            movies_category: movie.category
        }))
    };
    
    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `subsections_${type}_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function importSubsections(type) {
    const fileId = type === 'general' ? 'importGeneralSubsections' : 'importPrivateSubsections';
    const file = document.getElementById(fileId).files[0];
    
    if (!file) {
        alert('الرجاء اختيار الملف');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            const movies = data.movies_info || [];
            let addedCount = 0;
            
            movies.forEach(movie => {
                const movieLink = movie.movies_href || '#';
                const movieCategory = movie.movies_category || 'all';
                
                if (!isDuplicateMovie(movieLink, movieCategory)) {
                    appData.movies.push({
                        id: `movie_${Date.now()}_${Math.random()}`,
                        title: movie.movies_name || 'بدون عنوان',
                        imageUrl: movie.movies_img || 'https://via.placeholder.com/200x300',
                        link: movieLink,
                        category: movieCategory,
                        hidden: false,
                        site: extractSiteName(movieLink),
                        dateAdded: new Date().toISOString(),
                        isFavorite: false
                    });
                    addedCount++;
                }
            });
            
            saveData();
            updateCounters();
            displayMovies();
            alert(`تم استيراد ${addedCount} فيلم (تم تجاهل ${movies.length - addedCount} فيلم مكرر)`);
        } catch (error) {
            alert('خطأ في قراءة الملف');
        }
    };
    reader.readAsText(file);
}

function setupDragAndDrop() {
    const quickAddLink = document.getElementById('quickAddLink');
    
    quickAddLink.addEventListener('dragover', (e) => {
        e.preventDefault();
        quickAddLink.style.borderColor = 'var(--accent-primary)';
    });
    
    quickAddLink.addEventListener('dragleave', (e) => {
        quickAddLink.style.borderColor = '';
    });
    
    quickAddLink.addEventListener('drop', (e) => {
        e.preventDefault();
        quickAddLink.style.borderColor = '';
        
        const text = e.dataTransfer.getData('text/plain');
        if (text && text.startsWith('http')) {
            quickAddLink.value = text;
        }
    });
}

function displaySearchResults(results) {
    const container = document.getElementById('moviesContainer');
    container.innerHTML = '';
    
    if (results.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-muted);">لم يتم العثور على نتائج</p>';
        return;
    }
    
    results.forEach(movie => {
        const card = createMovieCard(movie);
        container.appendChild(card);
    });
}

function toggleCategoryDropdown(categoryId) {
    const dropdown = document.getElementById(categoryId);
    const allDropdowns = document.querySelectorAll('.sections-dropdown');
    const allCategoryBtns = document.querySelectorAll('.category-menu-btn');

    if (appData.settings.familyMode || appData.accessMode === 'family') {
        if (categoryId === 'privateSections' || categoryId === 'privateFavoritesSections') {
            return; 
        }
    }

    allCategoryBtns.forEach(btn => btn.classList.remove('active'));

    allDropdowns.forEach(dd => {
        if (dd.id !== categoryId) {
            dd.classList.add('hidden');
        }
    });

    dropdown.classList.toggle('hidden');

    if (!dropdown.classList.contains('hidden')) {
        event.target.classList.add('active');
    }
}

function setupHeaderScrollBehavior() {
    let lastScrollTop = 0;
    const header = document.querySelector('.app-header');
    
    window.addEventListener('scroll', () => {
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        
        if (scrollTop > 100) {
            header.style.transform = 'translateY(-100%)';
        } else {
            header.style.transform = 'translateY(0)';
        }
        
        lastScrollTop = scrollTop;
    });
}
