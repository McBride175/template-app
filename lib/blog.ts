import 'server-only'
import { promises as fs } from 'fs'
import path from 'path'

export interface BlogPostMeta {
  slug: string
  title: string
  description: string
  date: string
}

export interface BlogPost extends BlogPostMeta {
  content: string
}

const BLOG_DIR = path.join(process.cwd(), 'content', 'blog')

function parseFrontmatter(raw: string, fallbackSlug: string): BlogPost {
  let frontmatter: Record<string, string> = {}
  let body = raw

  if (raw.startsWith('---')) {
    const end = raw.indexOf('\n---', 3)
    if (end !== -1) {
      const block = raw.slice(3, end).trim()
      body = raw.slice(end + 4).trim()

      frontmatter = block.split('\n').reduce((acc, line) => {
        const idx = line.indexOf(':')
        if (idx === -1) return acc
        const key = line.slice(0, idx).trim()
        const value = line.slice(idx + 1).trim().replace(/^['\"]|['\"]$/g, '')
        acc[key] = value
        return acc
      }, {} as Record<string, string>)
    }
  }

  return {
    slug: frontmatter.slug || fallbackSlug,
    title: frontmatter.title || fallbackSlug,
    description: frontmatter.description || '',
    date: frontmatter.date || new Date().toISOString().slice(0, 10),
    content: body,
  }
}

export async function getAllPosts(): Promise<BlogPost[]> {
  const files = await fs.readdir(BLOG_DIR)
  const markdownFiles = files.filter((file) => file.endsWith('.md'))

  const posts = await Promise.all(
    markdownFiles.map(async (file) => {
      const slugFromFile = file.replace(/\.md$/, '')
      const filePath = path.join(BLOG_DIR, file)
      const raw = await fs.readFile(filePath, 'utf8')
      return parseFrontmatter(raw, slugFromFile)
    })
  )

  return posts.sort((a, b) => (a.date < b.date ? 1 : -1))
}

export async function getAllPostMetadata(): Promise<BlogPostMeta[]> {
  const posts = await getAllPosts()
  return posts.map(({ slug, title, description, date }) => ({
    slug,
    title,
    description,
    date,
  }))
}

export async function getPostBySlug(slug: string): Promise<BlogPost | null> {
  const posts = await getAllPosts()
  return posts.find((post) => post.slug === slug) ?? null
}
