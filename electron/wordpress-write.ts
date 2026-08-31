/**
 * Creating a published record from inside the app.
 *
 * Everything else that talks to WordPress here only reads. This writes, and
 * the shape it has to take was settled by running each question against a
 * real site rather than reasoning from the documentation, because three of
 * the answers are not what the documentation implies:
 *
 *   - **`acf` on `wp/v2` is display-only.** acf-to-rest-api registers it with
 *     a `get_callback` and no `update_callback`, so a write there is accepted
 *     and silently dropped — the post is created and every field is empty.
 *     Its own `acf/v3/<type>/<id>` route is the write path.
 *   - **WordPress eats one level of backslashes.** A listing sent as-is comes
 *     back with `\a\b\c` as `abc` and `\\` as `\`. That is a single
 *     stripslashes pass, and doubling them first restores the text exactly —
 *     the same reasoning the CSV importer's `wp_slash()` carries, at the
 *     other end of the pipe. Without it a listing is quietly unrebuildable,
 *     which is worse than one that obviously fails.
 *   - **Something stamps a featured image on creation.** A default
 *     `_thumbnail_id` appears on every new post and cannot be cleared by
 *     setting it to zero; it can be replaced by a real attachment, which is
 *     what a program with a screenshot wants anyway.
 *
 * Records are created as drafts. Nothing here publishes, and nothing here
 * deletes or overwrites an existing post.
 */

export interface WpAuth {
  user: string;
  /** An application password, from Users → Profile. */
  password: string;
}

export interface WpTerm { id: number; name: string }

export class WpWriteError extends Error {}

/** The ACF fields a record carries, by the name ACF knows them under. */
export interface AcfFields {
  download_url?: string;
  mediadate?: string;
  'media-type'?: string;
  media_type_tags?: string;
  spectrum_computing?: string;
  source_code?: string;
  /** `company` post ids. */
  'producer-company'?: number[];
  /** `indiv` term ids. */
  programmers?: number[];
  /** Attachment ids. */
  images?: number[];
}

/** The core taxonomies, which are written on `wp/v2` as term ids. */
export interface Taxonomies {
  basic?: number[];
  model?: number[];
  genre?: number[];
  tags?: number[];
}

export interface NewRecord {
  title: string;
  content?: string;
  excerpt?: string;
  /**
   * The filename the CSV importer would have recorded. Stamped so that both
   * tools agree on when two records are the same record; without it a later
   * CSV run would create a duplicate rather than update this one.
   */
  sourceFilename: string;
  taxonomies?: Taxonomies;
}

/**
 * `wp_slash()`, done on this side.
 *
 * Every string bound for a text field goes through here. A listing is the
 * reason — it is zmakebas source, and its backslashes are the difference
 * between a program that can be rebuilt and one that only looks right.
 */
export function slashForWordPress(value: string): string {
  return value.replace(/\\/g, '\\\\');
}

export class WpWriter {
  constructor(private baseUrl: string, private auth: WpAuth) {}

  private get header(): string {
    return 'Basic ' + Buffer.from(`${this.auth.user}:${this.auth.password}`).toString('base64');
  }

  private async call(
    path: string, init: RequestInit = {}, timeoutMs = 30000,
  ): Promise<any> {
    const control = new AbortController();
    const timer = setTimeout(() => control.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl.replace(/\/+$/, '')}/wp-json${path}`, {
        ...init,
        signal: control.signal,
        headers: {
          authorization: this.header,
          'content-type': 'application/json',
          ...(init.headers ?? {}),
        },
      });
    } catch (err: any) {
      throw new WpWriteError(
        err?.name === 'AbortError' ? 'The site did not answer in time.' : `Could not reach the site: ${err?.message}`,
      );
    } finally {
      clearTimeout(timer);
    }

    const body = await res.json().catch(() => null);
    if (res.status === 401 || res.status === 403) {
      throw new WpWriteError(
        'The site refused the credentials. Check the username and application password in Preferences.',
      );
    }
    if (!res.ok) {
      throw new WpWriteError(body?.message ?? `The site answered ${res.status} ${res.statusText}.`);
    }
    return body;
  }

  /** Does this credential work, and may it edit posts? */
  async checkCredentials(): Promise<{ name: string; canEdit: boolean }> {
    const me = await this.call('/wp/v2/users/me?context=edit', {}, 10000);
    return {
      name: String(me?.name ?? ''),
      canEdit: Boolean(me?.capabilities?.edit_posts || me?.capabilities?.administrator),
    };
  }

  /** Every term of a taxonomy, for matching names against what exists. */
  async listTerms(taxonomy: string): Promise<WpTerm[]> {
    const out: WpTerm[] = [];
    for (let page = 1; ; page++) {
      const batch = await this.call(`/wp/v2/${taxonomy}?per_page=100&page=${page}&_fields=id,name`);
      if (!Array.isArray(batch) || batch.length === 0) break;
      out.push(...batch.map((t: any) => ({ id: Number(t.id), name: String(t.name ?? '') })));
      if (batch.length < 100) break;
    }
    return out;
  }

  /** `company` posts, which `producer-company` points at by id. */
  async listCompanies(): Promise<WpTerm[]> {
    const out: WpTerm[] = [];
    for (let page = 1; ; page++) {
      const batch = await this.call(`/wp/v2/company?per_page=100&page=${page}&_fields=id,title`);
      if (!Array.isArray(batch) || batch.length === 0) break;
      out.push(...batch.map((p: any) => ({ id: Number(p.id), name: String(p.title?.rendered ?? '') })));
      if (batch.length < 100) break;
    }
    return out;
  }

  /**
   * An `indiv` term for a person, made if the archive has never heard of
   * them. People are the one vocabulary that grows by importing: a programmer
   * nobody has catalogued before is ordinary, where a BASIC keyword or a
   * machine the site does not know is far more likely to be a typo.
   */
  async findOrCreatePerson(name: string): Promise<WpTerm> {
    const trimmed = name.trim();
    const found = await this.call(`/wp/v2/indiv?search=${encodeURIComponent(trimmed)}&per_page=20&_fields=id,name`);
    const exact = (Array.isArray(found) ? found : [])
      .find((t: any) => String(t.name ?? '').toLowerCase() === trimmed.toLowerCase());
    if (exact) return { id: Number(exact.id), name: String(exact.name) };

    const made = await this.call('/wp/v2/indiv', {
      method: 'POST',
      body: JSON.stringify({ name: trimmed }),
    });
    return { id: Number(made.id), name: String(made.name ?? trimmed) };
  }

  /** Create the draft. Taxonomies go on here; ACF fields do not. */
  async createDraft(record: NewRecord): Promise<number> {
    const body: Record<string, unknown> = {
      title: slashForWordPress(record.title),
      status: 'draft',
      meta: { _wcmi_source_filename: record.sourceFilename },
      ...(record.content ? { content: slashForWordPress(record.content) } : {}),
      ...(record.excerpt ? { excerpt: slashForWordPress(record.excerpt) } : {}),
      ...(record.taxonomies ?? {}),
    };
    const made = await this.call('/wp/v2/computer_media', { method: 'POST', body: JSON.stringify(body) });
    if (!made?.id) throw new WpWriteError('The site created no record.');
    return Number(made.id);
  }

  /**
   * Write the ACF fields, through the route that actually writes them.
   *
   * Only the text fields are slashed. The relationship, taxonomy and gallery
   * fields carry numbers, which have no backslashes to lose and would be
   * corrupted by being treated as text.
   */
  async writeAcf(postId: number, fields: AcfFields): Promise<void> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      out[key] = typeof value === 'string' ? slashForWordPress(value) : value;
    }
    if (Object.keys(out).length === 0) return;
    await this.call(`/acf/v3/computer_media/${postId}`, {
      method: 'POST',
      body: JSON.stringify({ fields: out }),
    });
  }

  /** Put an image in the media library and return its attachment id. */
  async uploadImage(filename: string, bytes: Buffer, mime = 'image/png'): Promise<number> {
    const res = await fetch(`${this.baseUrl.replace(/\/+$/, '')}/wp-json/wp/v2/media`, {
      method: 'POST',
      headers: {
        authorization: this.header,
        'content-type': mime,
        'content-disposition': `attachment; filename="${filename.replace(/"/g, '')}"`,
      },
      body: new Uint8Array(bytes),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.id) {
      throw new WpWriteError(body?.message ?? `Uploading ${filename} failed (${res.status}).`);
    }
    return Number(body.id);
  }

  /**
   * Replace the featured image. Something on the site stamps a default one
   * during creation which cannot be cleared, so this only ever sets a real
   * attachment over it.
   */
  async setFeaturedImage(postId: number, attachmentId: number): Promise<void> {
    await this.call(`/wp/v2/computer_media/${postId}`, {
      method: 'POST',
      body: JSON.stringify({ featured_media: attachmentId }),
    });
  }

  /**
   * Ask the describer plugin what the program is.
   *
   * It reads the listing and gallery off the post, so this only means
   * anything once the record has both. It returns the text rather than
   * writing it, which is why the description is applied separately.
   */
  async describe(postId: number, useWebSearch = false): Promise<{ description: string; teaser: string; mode: string }> {
    const r = await this.call('/wp/v2/ts-program-describer/analyze', {
      method: 'POST',
      body: JSON.stringify({ post_id: postId, use_web_search: useWebSearch }),
    }, 180000);   // it calls a model; two minutes is its own timeout
    return {
      description: String(r?.description ?? ''),
      teaser: String(r?.teaser ?? ''),
      mode: String(r?.mode ?? ''),
    };
  }

  async applyDescription(postId: number, description: string, teaser: string): Promise<void> {
    await this.call(`/wp/v2/computer_media/${postId}`, {
      method: 'POST',
      body: JSON.stringify({
        content: slashForWordPress(description),
        excerpt: slashForWordPress(teaser),
      }),
    });
  }

  /** Where a reader goes to look at what was made. */
  editUrl(postId: number): string {
    return `${this.baseUrl.replace(/\/+$/, '')}/wp-admin/post.php?post=${postId}&action=edit`;
  }
}
