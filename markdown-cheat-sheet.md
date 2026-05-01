/*eslint-disable markdown/no-missing-label-refs*/

# Markdown Cheat Sheet

Thanks for visiting [The Markdown Guide](https://www.markdownguide.org)!

This Markdown cheat sheet provides a quick overview of all the Markdown
syntax elements. It can't cover every edge case, so if you need more
information about any of these elements, refer to the reference guides for
[basic syntax](https://www.markdownguide.org/basic-syntax/) and
[extended syntax](https://www.markdownguide.org/extended-syntax/).

## Basic Syntax

These are the elements outlined in John Gruber's original design
document. All Markdown applications support these elements.

### Heading

```markdown
# H1

## H2

### H3
```

### Bold

This is **bold text**

### Italic

This is *italicized text*

### Blockquote

> blockquote

### Ordered List

1. First item
2. Second item
3. Third item

### Unordered List

- First item
- Second item
- Third item

### Code

`code`

### Horizontal Rule

---

### Link

[Markdown Guide](https://www.markdownguide.org)

### Image

![alt text](https://www.markdownguide.org/assets/images/tux.png)

## GitHub‑Flavored Markdown (GFM) — Indentation & HTML/CSS Cheat Sheet

This reference focuses on **indentation**, **lists**,
**code blocks**, and **HTML/CSS usage** in GitHub Markdown.

---

## Indentation fundamentals

### Paragraphs

- A blank line **separates** paragraphs.
- Avoid leading spaces unless you intend a **code block**.

### Line breaks

- End a line with **two spaces** for a soft line break, or use `<br>`.

```md
Line one␠␠
Line two
```

### Blockquotes

Use `>`; nest with `>>`:

```md
> Level 1
>> Level 2
>>> Level 3
```

### Lists (ordered & unordered)

- Indent **2–4 spaces** to nest items.
- Ordered lists can be written with all `1.`; GitHub auto‑numbers.

```md
1. First
1. Second
   - Nested bullet
     - Deeper bullet
2. Third
```

### Task lists

```md
- [ ] Todo item
- [x] Done item
```

---

## Code blocks & inline code

### Inline

Use backticks: ``Use `code` inline``

### Fenced code blocks (recommended)

Use triple backticks with a language tag:

```bash
npm run inline-css:apply
```

### Indented code blocks

- Start a line with **four spaces** (or a tab).
- Less portable; fenced blocks are preferred.

---

## Tables (alignment & indentation)

```md
| Column | Right | Center |
|-------:|:-----:|-------:|
|    123 |  yes  |    999 |
```

- `:---` left aligns; `:---:` centers; `---:` right aligns.
- Keep table rows aligned for readability; spacing is optional.

---

## HTML inside Markdown (GitHub)

GitHub supports many HTML tags, but **sanitizes** content:

- **Allowed**: many structural tags (`<details>`, `<summary>`, `<kbd>`,
  `<sub>`, `<sup>`, `<br>`, `<img>`, `<a>`, etc.).
- **Sanitized/stripped**: many `style` attributes and `<style>` blocks.
  Avoid custom CSS.
- **Inline styles** may not render as expected; prefer pure Markdown or
  permitted HTML attributes.

### Useful patterns

**Details/summary toggle:**

```html
<details>
  <summary>Click to expand</summary>
  Hidden content here.
</details>
```

```html
<details>
  <summary>Click to expand</summary>
  Hidden content here.
</details>
    <br>
```

**Keyboard input:**

```html
Press <kbd>Ctrl</kbd> + <kbd>C</kbd> to copy.


Press <kbd>Ctrl</kbd> + <kbd>C</kbd> to copy.
```

**Line breaks in lists:**

```md
- Line one
- Line two continues under the same bullet.
```

---

## Linking images & badges

```md
![Alt text](./path/to/image.png)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[!License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

```

---

## Escaping characters

- Backslash‑escape Markdown symbols: `\*  \_  \@  \/`
- For literal backticks inside code spans, use **triple** backticks outside.

```html
<pre>

Use backticks like `this`

</pre>

```

---

## Common pitfalls

- **Indenting lists with tabs**: use spaces for consistent rendering across editors.
- **Mixing tabs & spaces**: can break nested lists—stick to spaces.
- **Relying on CSS**: GitHub strips many styles; avoid custom CSS in Markdown.
- **Trailing whitespace removal**: some editors strip the two spaces needed for soft line breaks.

---

## Quick reference

- New paragraph → blank line
- Soft line break → two spaces at end of line
- Nest list → indent 2–4 spaces
- Code → `` `inline` `` or fenced block
- Table alignment → `:---`, `:---:`, `---:`
- HTML allowed but sanitized; avoid custom CSS

## Extended Syntax

These elements extend the basic syntax by adding additional features. Not all Markdown applications support these elements.

### Table

| Syntax    | Description |
|-----------|-------------|
| Header    | Title       |
| Paragraph | Text        |

### Fenced Code Block

```json
{
  "firstName": "John",
  "lastName": "Smith",
  "age": 25
}
```

### Footnote

Here's a sentence^1^ with a footnote^*^.

^1^ note: This is the first footnote.
^*^ note: This is the second footnote.

### Heading ID

### My Great Heading {#custom-id}

### Definition List

term
: definition

### Strikethrough

~~The world is flat.~~

### Task List

- [x] Write the press release
- [ ] Update the website
- [ ] Contact the media

### Emoji

That is so funny! :joy:

(See also [Copying and Pasting Emoji](https://www.markdownguide.org/extended-syntax/#copying-and-pasting-emoji))

### Highlight

I need to highlight these ==very important words==.

### Subscript

H~2~O

### Superscript

X^2^

$${\color{lightblue}Light \space Blue}$$

<code style="color : blue">$\color{White}{\textsf{Normal, colored text}}$</code>

$\color{Green}{\textsf{Normal, colored text}}$

$\color{White}{\textsf{Normal, colored text}}$

$\color{LightBlue}{\textsf{Normal, colored text}}$

$\color{Red}{\textsf{Normal, colored text}}$

$\color{Orange}{\textsf{Normal, colored text}}$

$\color{LightGreen}{\textsf{Normal, colored text}}$

$\color{salmon}\Large{\textsf{Large, colored text}}$

$\color{tan}\Huge{\textsf{Huge, colored text}}$

_____________________

$\color{LightBlue}{\textbf{Normal, Bold and colored text}}$

$\color{Yellow}\Large{\textbf{Large, Bold and colored text}}$

$\color{Orange}\Huge{\textbf{Huge, Bold and colored text}}$

- textsf for normal text

- extbf for Bold text,

as suggested here:
 <https://tex.stackexchange.com/a/22661>
