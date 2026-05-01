# Malformed Showcase

This fixture mixes pathological markdown so the renderer is forced to do
best-effort recovery. Issue #11 pins that none of these patterns crash
the editor; partial / verbatim-as-text rendering is acceptable.

## Unclosed fenced code block

```js
const x = 1;
console.log('this fence is never closed below

## Broken table — header column count mismatches separator

| Risk | Likelihood | Mitigation |
|---|
| A    | High       | Mitigate   |
| B    | Low        | Accept     |

## Raw HTML must be escaped (regression pin from #14)

<div onclick="alert('xss')">click me</div>
<script>alert('not allowed')</script>

## Deeply nested list (10 levels)

- one
  - two
    - three
      - four
        - five
          - six
            - seven
              - eight
                - nine
                  - ten

## Unmatched emphasis

This **bold has no close
And this *italic also has no close.

## Malformed link

[text without closing paren( and a [nested [bracket]] mess.

## Mixed Unicode and RTL

Mixed: שלום ✨ 🎉 Hello مرحبا — ABC​‌‍ (zero-width joiners hiding)

## Trailing HR with no content

---
