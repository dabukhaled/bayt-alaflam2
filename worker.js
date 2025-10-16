// worker.js

// Keep track of which chunk to load next
let nextChunk = 2;
const maxFiles = 20; // The maximum number of chunk files to check for

self.onmessage = async function(e) {
    if (e.data.command === 'start') {
        try {
            // Reset chunk counter on new start
            nextChunk = 2;
            
            self.postMessage({ type: 'progress', payload: { progress: 5, text: 'البحث عن البيانات الأولية...' } });
            const response1 = await fetch('database_chunks/app_database1.json').catch(() => null);

            if (response1 && response1.ok) {
                // New method successful, process only the first file
                await processInitialChunk(response1);
            } else {
                // Fallback to old single-file method
                self.postMessage({ type: 'progress', payload: { progress: 10, text: 'لم يتم العثور على بيانات مجزأة، العودة للطريقة القديمة...' } });
                await new Promise(resolve => setTimeout(resolve, 1000));
                await processSingleFile();
            }

        } catch (error) {
            self.postMessage({ type: 'error', payload: error.message });
        }
    } else if (e.data.command === 'loadNextChunk') {
        // New command to load the next available chunk
        if (nextChunk > maxFiles) {
            self.postMessage({ type: 'done', payload: { allChunksLoaded: true } });
            return;
        }

        try {
            const response = await fetch(`database_chunks/app_database${nextChunk}.json`).catch(() => null);
            if (response && response.ok) {
                const data = await response.json();
                const movies = data.movies_info || data.movies || [];
                self.postMessage({ type: 'data', payload: movies, format: data.movies ? 'alternate' : 'default', isFirstBatch: false });
                
                // Increment for the next call
                nextChunk++;
                self.postMessage({ type: 'chunkLoaded', payload: { chunkNumber: nextChunk - 1 } });

            } else {
                // No more files found
                self.postMessage({ type: 'done', payload: { allChunksLoaded: true } });
            }
        } catch (error) {
            self.postMessage({ type: 'error', payload: `Error loading chunk ${nextChunk}: ${error.message}` });
        }
    }
};

async function processInitialChunk(initialResponse) {
    self.postMessage({ type: 'progress', payload: { progress: 20, text: 'تم العثور على البيانات الأولية، جاري التحميل...' } });
    
    // STAGE 1: Process the first file (app_database1.json)
    const data1 = await initialResponse.json();
    const initialMovies = data1.movies_info || data1.movies || [];
    if (data1.settings) {
        self.postMessage({ type: 'settings', payload: data1.settings });
    }
    self.postMessage({ type: 'data', payload: initialMovies, format: data1.movies ? 'alternate' : 'default', isFirstBatch: true });
    
    // STAGE 2 is now removed from here. We are done after the first file.
    self.postMessage({ type: 'progress', payload: { progress: 100, text: 'اكتمل تحميل البيانات الأولية!' } });
    self.postMessage({ type: 'done', payload: { allChunksLoaded: false } }); // Signal that initial load is done, but more chunks may exist
}

async function processSingleFile() {
    // This is the old logic for handling a single, large app_database.json
    self.postMessage({ type: 'progress', payload: { progress: 15, text: 'جاري الاتصال بقاعدة البيانات...' } });
    const response = await fetch('app_database.json').catch(() => null);

    if (!response || !response.ok) {
        self.postMessage({ type: 'fallback' }); // Tell main thread to use localStorage
        return;
    }

    self.postMessage({ type: 'progress', payload: { progress: 25, text: 'تم استلام البيانات، التحليل على وشك البدء...' } });
    const text = await response.text();
    
    await new Promise(resolve => setTimeout(resolve, 20)); 
    self.postMessage({ type: 'progress', payload: { progress: 50, text: 'جاري تحليل البيانات الأساسية (قد يستغرق بعض الوقت)..' } });
    await new Promise(resolve => setTimeout(resolve, 20)); 

    const data = JSON.parse(text);

    self.postMessage({ type: 'progress', payload: { progress: 75, text: 'تم التحليل، جاري إرسال البيانات...' } });
    const allMovies = data.movies_info || data.movies || [];
    if (data.settings) {
        self.postMessage({ type: 'settings', payload: data.settings });
    }
    
    // Send data in chunks to avoid overwhelming the main thread
    const chunkSize = 500;
    for(let i = 0; i < allMovies.length; i += chunkSize) {
        const chunk = allMovies.slice(i, i + chunkSize);
        self.postMessage({ type: 'data', payload: chunk, format: data.movies ? 'alternate' : 'default', isFirstBatch: (i === 0) });
    }

    self.postMessage({ type: 'progress', payload: { progress: 100, text: 'اكتمل التحديث!' } });
    self.postMessage({ type: 'done' });
}
