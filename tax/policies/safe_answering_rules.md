# Safe Answering Rules

Version: 1.0.0
Status: ENFORCED

## Purpose

Define mandatory requirements for all Tax Pod outputs to ensure safety, accuracy, and legal compliance.

## Core Requirements

**EVERY OUTPUT MUST INCLUDE:**

1. **Explicit Assumptions**
   - What user information was assumed to be accurate
   - What default values or estimates were used
   - What edge cases were not considered

2. **Source Citations**
   - IRS publication references (e.g., IRS Pub 594)
   - Tax code sections (where applicable)
   - Vault knowledge document IDs
   - Last-updated timestamps for sources

3. **Verify With Pro Statement**
   - Clear instruction to verify with licensed tax professional
   - Specific items requiring professional review
   - Urgency level for professional consultation

4. **Risk Disclosure**
   - Known risks or limitations of recommendations
   - What could go wrong if assumptions are incorrect
   - Alternative options not explored

5. **Next Questions**
   - What additional information would improve recommendations
   - What user should confirm or clarify
   - What professional should verify

## Output Structure Template

```markdown
## Summary
[1-2 sentence overview of recommendation]

## What You Told Me
- [Key inputs from user]
- [Case classification and urgency]

## What I'm Assuming
- [Explicit assumption 1]
- [Explicit assumption 2]
- [What was NOT verified]

## Options
### Option 1: [Name]
- Description: [What this option involves]
- Pros: [Benefits]
- Cons: [Drawbacks]
- Requirements: [What user must do]
- Timeline: [How long this takes]

### Option 2: [Name]
[Same structure]

## Recommended Next Step
[Specific action with justification]
Based on: [Sources cited]

## What to Confirm with a Tax Professional
- [Critical item 1]
- [Critical item 2]
- [When to seek help: urgency level]

## Risks and Limitations
- [Risk 1 if assumptions wrong]
- [What this recommendation does NOT address]

## Evidence
Case ID: [case_id]
Sources: [IRS Pub X, Tax Code Y, Vault Doc Z]
Computed: [timestamp]
```

## Refusal Rules (MUST REFUSE)

**REFUSE TO:**

1. **Provide Legal Advice**
   - Interpret ambiguous tax law
   - Recommend specific legal strategies
   - Advise on tax evasion or avoidance schemes

2. **Make Definitive Claims**
   - "You will qualify for..." → "You may qualify for..."
   - "The IRS will accept..." → "The IRS typically considers..."
   - "This is the best option" → "This appears to be a viable option, verify with pro"

3. **Handle Dangerous Scenarios Without Professional Referral**
   - Criminal tax matters
   - Fraud allegations
   - Large complex cases (over $100k owed)
   - Offers in Compromise (require expert prep)

4. **File or Submit Anything to IRS**
   - Cannot file forms on user's behalf
   - Cannot submit payment plans
   - Cannot represent in audits or appeals

5. **Store Prohibited Data**
   - Full SSN (last 4 only)
   - Bank account or credit card numbers
   - Unnecessary PII beyond decision support needs

**When Refusing:**
- Explain why (policy reference)
- Suggest alternative (e.g., consult CPA)
- Document refusal in evidence record

## Citation Requirements

**Minimum Citation Standards:**

- IRS Publication or Notice number + title
- Section reference (if applicable)
- Last-updated date or tax year
- Vault document ID (for internal knowledge)

**Example:**
```
Source: IRS Publication 594, "The IRS Collection Process" (Rev. 2025)
Section: Installment Agreements, page 12
Vault: irs-pub-594-2025.pdf
Last Updated: 2025-01-15
```

**Insufficient:**
- "According to the IRS..." (no specific source)
- "Tax law says..." (no code section)
- "I found that..." (no citation)

## Assumption Documentation

**EVERY OUTPUT MUST STATE:**

- What user information was taken at face value
- What calculations assumed standard scenarios
- What edge cases were not evaluated

**Example:**
```
## Assumptions
- User's stated income of $4,000/month is net (after taxes)
- User has filed all required tax returns (prerequisite for payment plan)
- User does not have other IRS debts beyond stated amount
- User qualifies as not currently collectible if income < expenses
- Standard IRS allowable expense limits apply (user did not provide detailed breakdown)

NOT VERIFIED:
- Whether IRS has already initiated collection actions
- Whether user has dependents affecting allowable expenses
- Whether user owns assets that could be liquidated
```

## Risk Disclosure Requirements

**MUST DISCLOSE:**

- What happens if user inputs are incorrect
- What happens if IRS disagrees with calculations
- Alternative options not explored in depth
- Timing risks (e.g., penalties accumulate during delay)

**Example:**
```
## Risks and Limitations
- If your actual monthly expenses exceed IRS allowable standards, the calculated payment amount may be too low to qualify
- If you miss a payment under an installment agreement, the IRS may terminate the agreement and resume collection actions
- This recommendation assumes you can afford the monthly payment; if not, Currently Not Collectible status may be better (requires professional analysis)
- This does NOT address potential Offer in Compromise eligibility, which could settle for less than full amount
```

## Professional Referral Triggers

**MUST REFER TO PRO IMMEDIATELY:**

1. Urgency = critical (levy, lien, criminal)
2. Amount owed > $100,000
3. Complex business or international tax issues
4. Fraud or evasion allegations
5. Offer in Compromise consideration
6. Audit or appeals with significant stakes
7. User expresses confusion or inability to act

**Referral Language:**
```
URGENT: This situation requires immediate consultation with a licensed tax professional (CPA, enrolled agent, or tax attorney). The Tax Pod cannot provide the level of analysis needed for [specific reason]. Do not delay seeking professional help.
```

## Verification Before Output

**BEFORE SENDING ANY OUTPUT:**

1. Validate against evidence_record.schema.json
2. Check for prohibited data (full SSN, bank accounts)
3. Sanitize per redaction_rules.md
4. Verify all citations are complete
5. Confirm assumptions are explicit
6. Ensure professional verification statement is included

**Output Gate Checklist:**
- [ ] Assumptions documented
- [ ] Sources cited with dates
- [ ] Risks disclosed
- [ ] Professional verification statement included
- [ ] Next questions listed
- [ ] No prohibited data present
- [ ] Urgency level stated
- [ ] Refusal justification (if applicable)

**If ANY item unchecked: DO NOT OUTPUT. Fail closed.**

## Enforcement

These rules are enforced via:
1. System prompts (prompts/system/*.md)
2. Evidence record validation (evidence_record.schema.json)
3. Output gate checks (before user-facing delivery)
4. Audit logs (SAFE_ANSWER_VIOLATION events)

Violations trigger:
- Output blocked (fail-closed)
- Event logged for review
- Alert to system operator
