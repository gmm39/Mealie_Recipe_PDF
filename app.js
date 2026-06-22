import express from "express";
import axios from "axios";
import NodeCache from "node-cache";
import puppeteer from "puppeteer";
import ejs from "ejs";
import path from "path";
import JSZip from "jszip";
import { marked } from 'marked';
import { fileURLToPath } from "url";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// === Configuration & Environment ===
const MEALIE_URL = process.env.MEALIE_URL || "http://localhost:9000";
const MEALIE_TOKEN = process.env.MEALIE_TOKEN;
const PORT = process.env.PORT || 3000;
const CACHE_TTL = parseInt(process.env.CACHE_TTL) || 3600;

if (!MEALIE_TOKEN) {
  console.error("❌ MEALIE_TOKEN environment variable is required");
  process.exit(1);
}

// === Initialization ===
const app = express();
const cache = new NodeCache({ stdTTL: CACHE_TTL });

app.use(express.json());
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

// === Mealie API Services ===

const mealieHeaders = () => ({
  Authorization: `Bearer ${MEALIE_TOKEN}`,
  "Content-Type": "application/json",
});

async function fetchRecipe(slug) {
  const cacheKey = `recipe_${slug}`;
  let recipe = cache.get(cacheKey);
  if (recipe) return recipe;

  try {
    const url = `${MEALIE_URL}/api/recipes/${slug}`;
    const response = await axios.get(url, { headers: mealieHeaders() });
    recipe = response.data;
    cache.set(cacheKey, recipe);
    return recipe;
  } catch (error) {
    console.error(`Failed to fetch recipe ${slug}:`, error.message);
    throw error;
  }
}

async function fetchAllRecipes() {
  const cacheKey = "all_recipes";
  let recipes = cache.get(cacheKey);
  if (recipes) return recipes;

  try {
    let page = 1;
    let allItems = [];
    let totalPages = 1;
    do {
      const url = `${MEALIE_URL}/api/recipes?page=${page}&perPage=100`;
      const response = await axios.get(url, { headers: mealieHeaders() });
      const data = response.data;
      const itemsWithImages = data.items.map((recipe) => ({
        ...recipe,
        fullImageUrl: `${MEALIE_URL}/api/media/recipes/${recipe.id}/images/original.webp`,
      }));
      allItems.push(...itemsWithImages);
      totalPages = data.total_pages;
      page++;
    } while (page <= totalPages);

    cache.set(cacheKey, allItems);
    return allItems;
  } catch (error) {
    console.error("Failed to fetch recipe list:", error.message);
    throw error;
  }
}

// === Recipe Data Utilities ===

/**
 * Partitions ingredients into a dynamic number of columns based on text length.
 * Uses a minimax partition algorithm to minimize the height of the tallest column,
 * ensuring the third column never becomes an unbalanced overflow.
 */
function getIngredientColumns(ingredients) {
  if (!ingredients || ingredients.length === 0) return [];

  // --- Tuning Parameters ---
  const SETTINGS = {
    charLimitTriple: 40,      // Max characters (name or note) to allow 3 columns
    charLimitDouble: 80,      // Max characters (name or note) to allow 2 columns
    minWeightTriple: 10,      // Minimum total weight to justify 3 columns (prevents tiny 3rd col)
    minWeightDouble: 4,       // Minimum total weight to justify 2 columns
    noteWeightAdd: 0.85,      // Visual weight addition for ingredients with notes
    itemWeight: 1.0,          // Base weight for standard ingredients
    wrapWeightAdd: 0.85,      // Visual weight addition if text wraps
    wrapLimitTriple: 25,      // Characters before wrapping in 3-column layout
    wrapLimitDouble: 60,      // Characters before wrapping in 2-column layout
    noteWrapWeightAdd: 0.6,   // Visual weight addition if note wraps
    noteWrapLimitTriple: 30,  // Note wrap limit for 3 columns
    noteWrapLimitDouble: 75   // Note wrap limit for 2 columns
  };

  // 1. Calculate statistics for layout decisions
  const maxLen = ingredients.reduce((max, ing) => 
    Math.max(max, (ing.display || "").length, (ing.note || "").length), 0);
  
  // Use base weights (item + note) to decide the initial column count
  const baseWeights = ingredients.map(ing => ing.note ? (SETTINGS.itemWeight + SETTINGS.noteWeightAdd) : SETTINGS.itemWeight);
  const baseTotalWeight = baseWeights.reduce((acc, w) => acc + w, 0);

  // 2. Determine optimal column count based on content length and density
  let numCols = 1;
  if (maxLen <= SETTINGS.charLimitTriple && baseTotalWeight >= SETTINGS.minWeightTriple) {
    numCols = 3;
  } else if (maxLen <= SETTINGS.charLimitDouble && baseTotalWeight >= SETTINGS.minWeightDouble) {
    numCols = 2;
  }

  if (numCols === 1) return [ingredients];
  if (ingredients.length < numCols) return [ingredients]; // Not enough items to split

  // 3. Minimax Partitioning Algorithm
  // Calculate final weights incorporating wrapping penalties specific to the chosen column layout.
  const wrapLimit = numCols === 3 ? SETTINGS.wrapLimitTriple : SETTINGS.wrapLimitDouble;
  const noteWrapLimit = numCols === 3 ? SETTINGS.noteWrapLimitTriple : SETTINGS.noteWrapLimitDouble;
  const weights = ingredients.map(ing => {
    let w = ing.note ? (SETTINGS.itemWeight + SETTINGS.noteWeightAdd) : SETTINGS.itemWeight;
    if ((ing.display || "").length > wrapLimit) {
      w += SETTINGS.wrapWeightAdd;
    }
    if (ing.note && ing.note.length > noteWrapLimit) {
      w += SETTINGS.noteWrapWeightAdd;
    }
    return w;
  });

  const n = ingredients.length;
  let bestMax = Infinity;
  let bestVariance = Infinity;
  let splitIndices = [];

  const sumW = (start, end) => {
    let s = 0;
    for (let k = start; k < end; k++) s += weights[k];
    return s;
  };

  if (numCols === 2) {
    for (let i = 1; i < n; i++) {
      const w1 = sumW(0, i);
      const w2 = sumW(i, n);
      const maxW = Math.max(w1, w2);
      const variance = Math.abs(w1 - w2);

      if (maxW < bestMax || (maxW === bestMax && variance < bestVariance)) {
        bestMax = maxW;
        bestVariance = variance;
        splitIndices = [i];
      }
    }
  } else if (numCols === 3) {
    for (let i = 1; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const w1 = sumW(0, i);
        const w2 = sumW(i, j);
        const w3 = sumW(j, n);
        const maxW = Math.max(w1, w2, w3);
        
        // Tie-breaker: minimize variance, with a slight preference 
        // for keeping the first two columns (w1, w2) even.
        const variance = (Math.abs(w1 - w2) * 1.2) + Math.abs(w2 - w3) + Math.abs(w1 - w3);

        if (maxW < bestMax || (maxW === bestMax && variance < bestVariance)) {
          bestMax = maxW;
          bestVariance = variance;
          splitIndices = [i, j];
        }
      }
    }
  }

  const columns = [];
  let lastIdx = 0;
  for (const idx of splitIndices) {
    columns.push(ingredients.slice(lastIdx, idx));
    lastIdx = idx;
  }
  columns.push(ingredients.slice(lastIdx));
  return columns;
}

function cleanIngredientText(ing) {
  let text = ing.display || ing.originalText || '';
  if (!text) {
    text = (ing.quantity ? ing.quantity + ' ' : '') +
           (ing.unit?.name || '') +
           (ing.food?.name ? ' ' + ing.food.name : '');
  }
  if (ing.note && text) {
    text = text.replace(ing.note, '').trim().replace(/\s+/g, ' ');
  }
  return text.replace('²¹/₃₂', '²/₃');
}

function formatInstructionText(text) {
  if (!text) return "";

  // Unescape basic HTML entities to ensure tags render correctly
    let formatted = text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Parse Markdown using the marked library for full feature support (GFM for tables)
  formatted = marked.parse(formatted, { gfm: true, breaks: true });

  // Resolve relative Mealie media URLs for Puppeteer
  formatted = formatted.replace(
    /src="\/api\/media\//g,
    `src="${MEALIE_URL}/api/media/`
  );

  return formatted;
}

// === Rendering & PDF Services ===

async function renderToString(view, data) {
  return new Promise((resolve, reject) => {
    ejs.renderFile(
      path.join(__dirname, "views", `${view}.ejs`),
      data,
      (err, html) => {
        if (err) reject(err);
        else resolve(html);
      },
    );
  });
}

/**
 * Converts a raw HTML string into a PDF Buffer using Puppeteer.
 */
async function htmlToPdf(html) {
  let browser = null;
  try {
    browser = await puppeteer.launch({
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 30000 });
    return await page.pdf({
      format: "Letter",
      printBackground: true,
      margin: { top: "0", bottom: "0", left: "0", right: "0" }
    });
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * Fetches the original image from Mealie and resizes it to a maximum dimension
 * to reduce PDF file size while preserving aspect ratio and avoiding cropping.
 */
async function getResizedImageBase64(recipeId) {
  try {
    const url = `${MEALIE_URL}/api/media/recipes/${recipeId}/images/original.webp`;
    const response = await axios.get(url, {
      headers: mealieHeaders(),
      responseType: "arraybuffer",
    });

    // Resize to max 400px (width or height) to ensure high print quality at 120px display
    // while drastically reducing the byte size compared to the original.
    const resizedBuffer = await sharp(response.data)
      .resize(300, 300, {
        fit: "cover",
        withoutEnlargement: true,
      })
      .webp({ quality: 75 })
      .toBuffer();

    return `data:image/webp;base64,${resizedBuffer.toString("base64")}`;
  } catch (error) {
    console.error(`Failed to process image for recipe ${recipeId}:`, error.message);
    return null;
  }
}

// === Route Handlers ===

app.get("/", async (req, res) => {
  try {
    const allTags = new Set();
    const allCategories = new Set();

    const recipes = await fetchAllRecipes();
    recipes.forEach((recipe) => {
      if (recipe.tags?.length)
        recipe.tags.forEach((tag) => allTags.add(tag.name));
      if (recipe.recipeCategory?.length)
        recipe.recipeCategory.forEach((cat) => allCategories.add(cat.name));
    });

    res.render("index", {
      recipes,
      allTags: Array.from(allTags).sort(),
      allCategories: Array.from(allCategories).sort(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error loading recipes");
  }
});

app.post("/api/print-pdf", async (req, res) => {
  const { slugs, options } = req.body;
  console.log('Received slugs:', slugs);
  if (!slugs || !Array.isArray(slugs) || slugs.length === 0) {
    return res.status(400).json({ error: "No recipe slugs provided" });
  }

  const printOptions = {
    showTags: options?.showTags ?? true,
    showImage: options?.showImage ?? false,
    showSource: options?.showSource ?? true,
    showNotes: options?.showNotes ?? true,
    combine: options?.combine ?? true,
    margin: options?.margin ?? '0.5in'
  };

  try {
    const recipes = await Promise.all(slugs.map((slug) => fetchRecipe(slug)));
    console.log('Fetched recipes:', recipes.map(r => r.slug));
    const htmlContents = await Promise.all(
      recipes.map(async (recipe) => {
        // Process Description and Notes for Markdown/HTML
        if (recipe.description) {
          recipe.description = formatInstructionText(recipe.description);
        }
        if (recipe.notes) {
          recipe.notes = recipe.notes.map(n => ({ ...n, text: formatInstructionText(n.text || "") }));
        }

        if (printOptions.showImage) {
          recipe.fullImageUrl = await getResizedImageBase64(recipe.id);
        }

        // Process instructions for Markdown and HTML
        recipe.recipeInstructions = (recipe.recipeInstructions || []).map((step) => {
          const rawText = typeof step === "string" ? step : step.text || "";
          return {
            ...(typeof step === "object" ? step : {}),
            text: formatInstructionText(rawText),
          };
        });

        if (recipe.name) recipe.name = recipe.name.trim();
        const ingredients = (recipe.recipeIngredient || []).map((ing) => ({
          ...ing,
          display: cleanIngredientText(ing),
        }));

    const ingredientColumns = getIngredientColumns(ingredients);
        const sourceDisplay = recipe.orgURL || "";
        const templateData = {
          recipe,
          sourceDisplay,
      ingredientColumns,
      // Fallback for existing templates expecting two columns
      leftIngredients: ingredientColumns[0] || [],
      rightIngredients: ingredientColumns[1] || [],
          options: printOptions,
        };
        return await renderToString("recipe-pdf", templateData);
      }),
    );

    if (printOptions.combine) {
      const combinedHtml = htmlContents.join(
        '<div style="page-break-after: always;"></div>',
      );
      const pdfBuffer = await htmlToPdf(combinedHtml);
      if (!pdfBuffer || pdfBuffer.length === 0)
        throw new Error("PDF buffer is empty");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", 'inline; filename="recipes.pdf"');
      return res.send(Buffer.from(pdfBuffer));
    } else {
      // Generate ZIP of individual PDFs using JSZip
      console.log("Generating ZIP with JSZip...");
      const zip = new JSZip();

      for (let i = 0; i < recipes.length; i++) {
        const pdfBuffer = await htmlToPdf(htmlContents[i]);
        if (!pdfBuffer || pdfBuffer.length === 0) {
          throw new Error(`Empty PDF buffer for recipe ${recipes[i].slug}`);
        }
        const safeName = recipes[i].slug.replace(/[^a-z0-9]/gi, "_") + ".pdf";
        zip.file(safeName, pdfBuffer);
      }

      const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="recipes.zip"',
      );
      res.send(zipBuffer);
      console.log("ZIP generated and sent");
    }
  } catch (error) {
    console.error("PDF generation error:", error);
    if (!res.headersSent) {
      res
        .status(500)
        .json({ error: error.message || "Failed to generate PDF(s)" });
    }
  }
});

// === Server Start ===

app.listen(PORT, () => {
  console.log(`Recipe site running on http://localhost:${PORT}`);
});
