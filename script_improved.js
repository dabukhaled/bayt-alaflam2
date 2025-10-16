// Global State
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
    accessMode: 'guest' // 'guest', 'family', 'full'
};

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    loadData(); // Load data first to get saved passwords
    checkAutoLogin();
    setupDragAndDrop();
    setupSearchSuggestions();
    setupHeaderScrollBehavior();

    // تحميل البيانات بشكل غير متزامن مع تأخير قصير لتحسين الأداء
    setTimeout(() => {
        loadDataFromFiles();
    }, 300);
});

// Password Check & Auto Login
function checkAutoLogin() {
    const savedLogin = localStorage.getItem('app_login');
    if (savedLogin) {
        const loginData = JSON.parse(savedLogin);
        if (loginData.accessMode === 'full') {
            appData.accessMode = 'full';
            document.getElementById('loginPage').classList.add('hidden');
            document.getElementById('mainApp').classList.remove('hidden');
        } else if (loginData.accessMode === 'family') {
            appData.accessMode = 'family';
            appData.settings.familyMode = true;
            document.getElementById('loginPage').classList.add('hidden');
            document.getElementById('mainApp').classList.remove('hidden');
            // Hide private menu buttons in family mode
            setTimeout(() => {
                const privateMenuBtns = document.querySelectorAll('.category-menu-btn');
                privateMenuBtns.forEach((btn, index) => {
                    // Hide "الأقسام الخاصة" and "المفضلات الخاصة" buttons (indices 2 and 3)
                    if (index === 2 || index === 3) {
                        btn.style.display = 'none';
                    }
                });
            }, 100);
        }
    }
}

function checkPassword() {
    const password = document.getElementById('passwordInput').value;

    if (password === appData.settings.fullPassword) {
        appData.accessMode = 'full';
        localStorage.setItem('app_login', JSON.stringify({ accessMode: 'full' }));
        document.getElementById('loginPage').classList.add('hidden');
        document.getElementById('mainApp').classList.remove('hidden');
        updateCounters();
        displayMovies();
        populateSelects();
    } else if (password === appData.settings.familyPassword) {
        appData.accessMode = 'family';
        appData.settings.familyMode = true;
        localStorage.setItem('app_login', JSON.stringify({ accessMode: 'family' }));
        document.getElementById('loginPage').classList.add('hidden');
        document.getElementById('mainApp').classList.remove('hidden');
        // Hide private menu buttons in family mode
        setTimeout(() => {
            const privateMenuBtns = document.querySelectorAll('.category-menu-btn');
            privateMenuBtns.forEach((btn, index) => {
                // Hide "الأقسام الخاصة" and "المفضلات الخاصة" buttons (indices 2 and 3)
                if (index === 2 || index === 3) {
                    btn.style.display = 'none';
                }
            });
        }, 100);
        updateCounters();
        displayMovies();
        populateSelects();
    } else {
        alert('كلمة المرور غير صحيحة');
    }
}

function logout() {
    localStorage.removeItem('app_login');
    appData.accessMode = 'guest';
    document.getElementById('mainApp').classList.add('hidden');
    document.getElementById('loginPage').classList.remove('hidden');
    document.getElementById('passwordInput').value = '';
}

// Data Management
async function loadDataFromFiles() {
    const loadingIndicator = document.getElementById('loadingIndicator');
    const progressFill = document.getElementById('loadingProgressFill');
    const progressText = document.getElementById('loadingProgressText');

    try {
        // Show loading indicator with a smooth animation
        loadingIndicator.classList.remove('hidden');

        // تحديث النص لتحسين تجربة المستخدم
        progressText.textContent = 'جاري البحث عن ملفات البيانات...';

        // Try to load from multiple database files
        const filePromises = [];

        // تحميل الملفات بشكل متسلسل وليس بشكل متوازٍ لتقليل الضغط على المتصفح
        let loadedFiles = 0;
        const totalFiles = 10;
        const validResults = [];

        for (let i = 1; i <= totalFiles; i++) {
            const fileName = i === 1 ? 'app_database.json' : `app_database${i}.json`;

            try {
                const response = await fetch(fileName, { 
                    signal: AbortSignal.timeout(5000) // إضافة مهلة 5 ثوانٍ لكل طلب
                });

                if (response.ok) {
                    const data = await response.json();
                    validResults.push(data);
                }
            } catch (err) {
                console.log(`لم يتم العثور على الملف: ${fileName}`);
            }

            loadedFiles++;
            const progress = (loadedFiles / totalFiles) * 50;
            progressFill.style.width = `${progress}%`;
            progressText.textContent = `${Math.round(progress)}%`;

            // إعطاء المتصفح فرصة للتنفس
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        if (validResults.length > 0) {
            // Update progress for processing
            progressText.textContent = 'جارٍ معالجة البيانات...';

            let processedResults = 0;
            const totalResults = validResults.length;

            // Merge all data from files
            for (const data of validResults) {
                if (data.movies_info) {
                    parseAndAddMovies(data.movies_info);
                }
                if (data.movies) {
                    parseAndAddMovies(data.movies, 'alternate');
                }
                if (data.settings) {
                    appData.settings = { ...appData.settings, ...data.settings };
                }

                processedResults++;
                const progress = 50 + (processedResults / totalResults) * 50;
                progressFill.style.width = `${progress}%`;
                progressText.textContent = `${Math.round(progress)}%`;

                // Allow UI to update - زيادة الوقت للسماح بتحديث الواجهة بشكل أفضل
                await new Promise(resolve => setTimeout(resolve, 50));
            }

            saveData();
            updateCounters();
            displayMovies();
            populateSelects();
        } else {
            progressText.textContent = 'لم يتم العثور على ملفات بيانات';
        }

        // Hide loading indicator with a smooth transition
        setTimeout(() => {
            loadingIndicator.classList.add('hidden');
            progressFill.style.width = '0%';
            progressText.textContent = '0%';
        }, 500);
    } catch (error) {
        console.error('Error loading from files:', error);
        progressText.textContent = 'حدث خطأ أثناء تحميل البيانات';

        // إخفاء مؤشر التحميل بعد فترة قصيرة
        setTimeout(() => {
            loadingIndicator.classList.add('hidden');
            progressFill.style.width = '0%';
            progressText.textContent = '0%';
        }, 2000);
    }
}

function parseAndAddMovies(movies, format = 'default') {
    movies.forEach(movie => {
        let movieData;

        if (format === 'alternate') {
            // Handle alternate JSON format
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
            // Handle default format
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

        // Check if movie already exists
        const exists = appData.movies.find(m => m.id === movieData.id);
        if (!exists) {
            appData.movies.push(movieData);
        }
    });
}

function loadData() {
    try {
        // Check if data is chunked
        const chunksCount = localStorage.getItem('app_database_chunks_count');

        if (chunksCount) {
            // Load from multiple chunks
            const totalChunks = parseInt(chunksCount);
            let allMovies = [];
            let settings = null;

            for (let i = 0; i < totalChunks; i++) {
                const chunkKey = i === 0 ? 'app_database' : `app_database_chunk${i + 1}`;
                const chunkData = localStorage.getItem(chunkKey);

                if (chunkData) {
                    const parsed = JSON.parse(chunkData);
                    if (parsed.movies_info) {
                        allMovies = allMovies.concat(parsed.movies_info);
                    }
                    if (parsed.settings && !settings) {
                        settings = parsed.settings;
                    }
                }
            }

            if (allMovies.length > 0) {
                appData.movies = allMovies.map((movie, index) => ({
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

            if (settings) {
                appData.settings = { ...appData.settings, ...settings };
            }
        } else {
            // Load from single item
            const savedData = localStorage.getItem('app_database');
            if (savedData) {
                const parsed = JSON.parse(savedData);
                if (parsed.movies_info) {
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
        }

        updateCounters();
        displayMovies();
        populateSelects();
    } catch (error) {
        console.error('Error loading data:', error);
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

        // Save to localStorage with chunking
        const dataString = JSON.stringify(dataToSave);
        const maxSize = 24 * 1024 * 1024; // 24 MB in bytes

        // Clear old chunks from localStorage
        let i = 1;
        while (localStorage.getItem(`app_database_chunk${i}`)) {
            localStorage.removeItem(`app_database_chunk${i}`);
            i++;
        }

        // If data is small enough, save as single item
        if (dataString.length < maxSize) {
            localStorage.setItem('app_database', dataString);
            localStorage.removeItem('app_database_chunks_count');
        } else {
            // Split into multiple chunks in localStorage
            const movies = dataToSave.movies_info;
            const settings = dataToSave.settings;
            const settingsSize = JSON.stringify({ settings, lastSaved: dataToSave.lastSaved }).length;
            const availableSize = maxSize - settingsSize - 1000; // Reserve space for structure

            // Calculate movies per chunk based on average movie size
            const avgMovieSize = JSON.stringify(movies[0]).length;
            const moviesPerChunk = Math.floor(availableSize / avgMovieSize);

            const chunks = [];
            for (let i = 0; i < movies.length; i += moviesPerChunk) {
                const chunk = movies.slice(i, i + moviesPerChunk);
                const chunkData = {
                    movies_info: chunk,
                    settings: i === 0 ? settings : undefined,
                    lastSaved: dataToSave.lastSaved,
                    chunkNumber: chunks.length + 1,
                    totalChunks: Math.ceil(movies.length / moviesPerChunk)
                };
                chunks.push(chunkData);
            }

            // Save chunks to localStorage
            chunks.forEach((chunk, index) => {
                const chunkKey = index === 0 ? 'app_database' : `app_database_chunk${index + 1}`;
                localStorage.setItem(chunkKey, JSON.stringify(chunk));
            });

            localStorage.setItem('app_database_chunks_count', chunks.length.toString());
        }
    } catch (error) {
        console.error('Error saving data:', error);
        alert('حدث خطأ أثناء حفظ البيانات');
    }
}

// Setup Header Scroll Behavior - تحسين وظيفة إخفاء شريط العنوان عند التمرير
function setupHeaderScrollBehavior() {
    let lastScrollTop = 0;
    const header = document.querySelector('.app-header');
    let scrollTimer = null;

    window.addEventListener('scroll', () => {
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

        // إلغاء المؤقت السابق
        if (scrollTimer) {
            clearTimeout(scrollTimer);
        }

        // إخفاء الشريط عند التمرير لأسفل
        if (scrollTop > lastScrollTop && scrollTop > 100) {
            header.style.transform = 'translateY(-100%)';
        } else {
            header.style.transform = 'translateY(0)';
        }

        lastScrollTop = scrollTop;

        // إضافة مؤقت لإظهار الشريط مرة أخرى بعد التوقف عن التمرير
        scrollTimer = setTimeout(() => {
            if (scrollTop < 100) {
                header.style.transform = 'translateY(0)';
            }
        }, 150);
    });
}

// إنشاء بطاقة فيلم مع عنوان في الأعلى
function createMovieCard(movie) {
    const card = document.createElement('div');
    card.className = 'movie-card';

    // تعديل بنية البطاقة لوضع العنوان في الأعلى
    card.innerHTML = `
        <div class="movie-title-header">
            <h3 class="movie-title-top" title="${movie.title}">${movie.title}</h3>
        </div>
        <div class="movie-poster-container">
            <img src="${movie.imageUrl}" alt="${movie.title}" class="movie-poster"
                 onerror="this.src='https://via.placeholder.com/200x300?text=No+Image'">
        </div>
        <div class="movie-info">
            <div class="movie-actions">
                <button class="btn-favorite ${movie.isFavorite ? 'active' : ''}"
                        onclick="toggleFavorite('${movie.id}')" title="إضافة للمفضلة">⭐</button>
                <span class="movie-site" title="${movie.site}">${movie.site}</span>
                <button class="btn-edit" onclick="openEditModal('${movie.id}')" title="تعديل">⋮</button>
            </div>
        </div>
    `;

    // Add copy functionality to movie title
    const titleElement = card.querySelector('.movie-title-top');
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
        if (!e.target.closest('.movie-actions') && !e.target.closest('.movie-title-top')) {
            window.open(movie.link, '_blank');
        }
    });

    return card;
}

// باقي الدوال...
